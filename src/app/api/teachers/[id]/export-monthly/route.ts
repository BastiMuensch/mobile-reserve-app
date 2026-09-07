import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs/promises';
import { safeMediaPath, safePublicPath, sanitizeFilenamePart, getImageRatio, getPdfImageFormat } from '@/lib/pdfGenerator';
import { getHolidayStatus, isDateCoveredByMaintainedFerien } from '@/lib/holidays';
import { schoolYearForExportMonth } from '@/lib/teacherExport';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get('month'); // e.g. "2026-03"
  if (!monthParam) {
    return NextResponse.json({ error: 'Month parameter is required (YYYY-MM)' }, { status: 400 });
  }

  // Erwartet wird "JJJJ-MM". Ohne diese Prüfung entstünde aus einem abweichenden
  // Format ein ungültiges Datum, das Prisma erst tief in der Abfrage abweist – der
  // Aufrufer sähe dann einen 500er statt eines verständlichen Hinweises.
  const [yearStr, monthStr] = monthParam.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (
    !/^\d{4}-\d{2}$/.test(monthParam) ||
    Number.isNaN(year) || Number.isNaN(month) ||
    month < 1 || month > 12 || year < 2000 || year > 2100
  ) {
    return NextResponse.json(
      { error: 'Ungültiger Monat. Erwartet wird das Format JJJJ-MM, z.B. 2026-03.' },
      { status: 400 }
    );
  }

  try {
    const { id } = await params;

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    // Authorize the row addressed in the URL first. A school-year copy shares a
    // login identity, but it must never turn a guessed row from another office
    // into an export target.
    const requestedTeacher = await prisma.teacher.findUnique({
      where: { id },
      include: { stammschule: true },
    });
    if (!requestedTeacher) {
      return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
    }
    const isTeacherOwner = userSession.role === 'TEACHER' && userSession.teachers?.some(t => t.id === requestedTeacher.id);
    const isSchulamtManager = userSession.role === 'SCHULAMT' && requestedTeacher.stammschule.schulamtId === userSession.id;
    if (!isTeacherOwner && !isSchulamtManager) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // A copied Teacher row represents the same person in another school year.
    // Resolve the selected month to that row only inside the already-authorized
    // office. Legacy rows without userId deliberately remain exact-row exports.
    const requestedSchoolYear = schoolYearForExportMonth(year, month);
    const teacherIdForMonth = requestedTeacher.userId
      ? (await prisma.teacher.findFirst({
          where: {
            userId: requestedTeacher.userId,
            schoolYear: requestedSchoolYear,
            stammschule: { schulamtId: requestedTeacher.stammschule.schulamtId },
          },
          select: { id: true },
        }))?.id
      : requestedTeacher.id;
    if (!teacherIdForMonth) {
      return NextResponse.json({ error: `Für ${monthParam} ist keine Schuljahreszeile dieser Lehrkraft vorhanden.` }, { status: 404 });
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherIdForMonth },
      include: {
        stammschule: {
          include: {
            schulamt: {
              include: {
                schulamtProfile: true
              }
            }
          }
        },
        assignments: {
          where: {
            status: { in: ['ACCEPTED', 'PENDING'] },
            date: {
              gte: startDate,
              lt: endDate
            }
          },
          include: {
            request: {
              include: {
                school: true
              }
            }
          }
        }
      }
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
    }

    const profile = teacher.stammschule.schulamt?.schulamtProfile;
    if (!profile || [profile.headerText, profile.returnAddress, profile.contactAddress, profile.contactPerson, profile.city, profile.amtsleitungName, profile.amtsleitungTitle].some(value => !value.trim())) {
      return NextResponse.json({ error: 'Das Schulamtsprofil ist unvollständig. Bitte Briefkopf und Unterschrift zuerst einrichten.' }, { status: 409 });
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // 1. Header (Kopfzeile)
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    const splitHeader = doc.splitTextToSize(profile.headerText, 110);
    doc.text(splitHeader, 25, 20);

    // 2. Right Side Contact Panel
    let sidebarY = 35;
    if (profile.logoUrl) {
      const logoPath = safePublicPath(profile.logoUrl);
      if (logoPath) {
        try {
          const logoData = (await fs.readFile(logoPath)).toString('base64');
          const ratio = await getImageRatio(logoPath);
          const format = await getPdfImageFormat(logoPath);
          const logoWidth = 42;
          const logoHeight = logoWidth / ratio;
          doc.addImage(`data:image/${format === 'PNG' ? 'png' : 'jpeg'};base64,${logoData}`, format, 143, sidebarY, logoWidth, logoHeight);
          sidebarY += logoHeight + 8;
        } catch (error) {
          console.error('Failed to add profile logo to monthly PDF:', error);
        }
      }
    }
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const addressLines = doc.splitTextToSize(profile.contactAddress, 42);
    doc.text(addressLines, 143, sidebarY);
    sidebarY += addressLines.length * 4 + 4;
    doc.text(doc.splitTextToSize(profile.contactPerson, 42), 143, sidebarY);

    // 3. Sender / Receiver Address
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    const returnAddr = profile.returnAddress;
    doc.text(returnAddr, 25, 50);
    doc.setLineWidth(0.2);
    doc.line(25, 51, 95, 51);

    doc.setFontSize(11);
    doc.text([
      "Herrn/Frau",
      teacher.name,
      teacher.address || "Adresse unbekannt",
    ], 25, 60);

    // 4. Date (top right below sidebar)
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    const today = new Date().toLocaleDateString('de-DE');
    doc.text(`${profile.city}, ${today}`, 143, 110);

    // 5. Subject
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Monatsübersicht als Mobile Reserve für ${teacher.name}`, 25, 125);
    doc.text(`Monat: ${monthStr}/${yearStr}`, 25, 132);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(`Sehr geehrte/r ${teacher.name},`, 25, 145);
    
    const introLines = doc.splitTextToSize(
      `aufgrund der entsprechenden Weisungen des Bayer. Staatsministeriums für Unterricht und Kultus ordnen wir Sie als Aushilfe ab von Ihrer Stammschule ${teacher.stammschule.name} an folgende Einsatzschule/n:`,
      160
    );
    doc.text(introLines, 25, 155);

    // 6. Table Generation
    const daysInMonth = new Date(year, month, 0).getDate();
    const tableBody = [];
    let ferienDataIncomplete = false;

    for (let d = 1; d <= daysInMonth; d++) {
      const currentDate = new Date(year, month - 1, d);
      const displayDate = currentDate.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

      if (!isDateCoveredByMaintainedFerien(currentDate)) {
        ferienDataIncomplete = true;
      }

      const holidayStatus = getHolidayStatus(currentDate);

      let schoolIdOrHoliday = "";
      let schoolNameAddr = "";

      if (holidayStatus) {
        schoolIdOrHoliday = holidayStatus;
      } else {
        const assignment = teacher.assignments.find((a: any) => {
          const aDate = new Date(a.date);
          return aDate.getFullYear() === year && aDate.getMonth() === month - 1 && aDate.getDate() === d;
        });
        if (assignment && assignment.request) {
          // wir zeigen z.B. die ID oder "Zugewiesen"
          schoolIdOrHoliday = "Zugewiesen";
          schoolNameAddr = `${assignment.request.school.name}, ${assignment.request.school.address}`;
        }
      }

      tableBody.push([
        displayDate,
        schoolIdOrHoliday,
        schoolNameAddr
      ]);
    }

    autoTable(doc, {
      startY: 155 + (introLines.length * 5) + 5,
      head: [['Einsatztage', 'Einsatzschule / Bemerkung', 'Name und Adresse Einsatzschule']],
      body: tableBody,
      margin: { left: 25, right: 25 },
      theme: 'grid',
      headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 2, textColor: [0, 0, 0] },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 45 },
        2: { cellWidth: 'auto' }
      }
    });

    // 6b. Hinweis, falls für diesen Monat keine gepflegten Ferientermine vorliegen.
    // Eine stille Falschangabe (Ferientage würden sonst als normale Arbeitstage gezählt)
    // ist inakzeptabel - siehe Wartungshinweis in src/lib/holidays.ts.
    let tableEndY = (doc as any).lastAutoTable.finalY || 200;
    if (ferienDataIncomplete) {
      const noteY = tableEndY + 6;
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(150, 30, 30);
      const noteLines = doc.splitTextToSize(
        'Hinweis: Ferientermine für diesen Zeitraum sind im System noch nicht hinterlegt. Tage, die tatsächlich in den Schulferien liegen, können in dieser Übersicht fälschlich als Arbeitstage erscheinen.',
        160
      );
      doc.text(noteLines, 25, noteY);
      tableEndY = noteY + (noteLines.length * 4);
    }

    // 7. Signature Area
    const finalY = tableEndY;

    let currentY = finalY + 20;

    if (profile?.signatureUrl) {
      const sigPath = safeMediaPath(profile.signatureUrl);
      if (sigPath) {
        try {
          await fs.access(sigPath);
          const sigData = (await fs.readFile(sigPath)).toString('base64');
          const ratio = await getImageRatio(sigPath);
          const format = await getPdfImageFormat(sigPath);
          const sigWidth = 45;
          const sigHeight = sigWidth / ratio;
          doc.addImage(`data:image/${format === 'PNG' ? 'png' : 'jpeg'};base64,${sigData}`, format, 25, currentY, sigWidth, sigHeight);
          currentY += sigHeight + 5;
        } catch {
          currentY += 20;
        }
      } else {
        currentY += 20;
      }
    } else {
      currentY += 20;
    }

    doc.setFontSize(11);
    doc.setFont('Helvetica', 'normal');
    doc.text(profile.amtsleitungName, 25, currentY);
    doc.text(profile.amtsleitungTitle, 25, currentY + 5);

    const pdfBuffer = doc.output('arraybuffer');

    const sanitizedFileName = `Monatsuebersicht_${sanitizeFilenamePart(teacher.name)}_${yearStr}-${monthStr}.pdf`;

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${sanitizedFileName}"`,
        'Cache-Control': 'private, no-store',
      }
    });

  } catch (error) {
    console.error('PDF Generation Error:', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
