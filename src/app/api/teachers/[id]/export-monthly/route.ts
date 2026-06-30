import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs/promises';
import path from 'path';
import { safePublicPath, sanitizeFilenamePart, getImageRatio } from '@/lib/pdfGenerator';
import { getHolidayStatus } from '@/lib/holidays';

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

  const [yearStr, monthStr] = monthParam.split('-');
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);

  try {
    const { id } = await params;

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    const teacher = await prisma.teacher.findUnique({
      where: { id },
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

    // Authorization
    const isTeacherOwner = userSession.role === 'TEACHER' && userSession.teachers?.some(t => t.id === teacher.id);
    const isSchulamtManager = userSession.role === 'SCHULAMT' && teacher.stammschule.schulamtId === userSession.id;
    const isAdmin = userSession.role === 'ADMIN';

    if (!isTeacherOwner && !isSchulamtManager && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const profile = teacher.stammschule.schulamt?.schulamtProfile;

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // 1. Header (Kopfzeile)
    const isDefaultHeader = !profile || profile.headerText === "Staatliches Schulamt Musterstadt" || profile.headerText === "Staatliche Schulämter im Landkreis Unterallgäu und in der Stadt Memmingen";
    let headerRendered = false;
    
    if (isDefaultHeader && !profile?.logoUrl) {
      const headerPath = path.join(process.cwd(), 'public', 'Kopfzeile.png');
      try {
        await fs.access(headerPath);
        const headerData = (await fs.readFile(headerPath)).toString('base64');
        doc.addImage(`data:image/png;base64,${headerData}`, 'PNG', 25, 15, 160, 7.64);
        headerRendered = true;
      } catch (err) {}
    }

    if (!headerRendered && profile) {
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(100, 100, 100);
      const splitHeader = doc.splitTextToSize(profile.headerText, 110);
      doc.text(splitHeader, 25, 20);
    }

    // 2. Right Side Contact Panel
    let sidebarRendered = false;
    if (profile) {
      const isDefaultAddress = profile.contactAddress.includes("Memminger Str. 18") && profile.contactAddress.includes("87719 Mindelheim");
      const isDefaultPerson = profile.contactPerson.includes("Tamara Schmidt") && profile.contactPerson.includes("Durchwahl");
      
      if (profile.logoUrl || !isDefaultAddress || !isDefaultPerson) {
        let sidebarY = 35;
        if (profile.logoUrl) {
          const logoPath = safePublicPath(profile.logoUrl);
          if (logoPath) {
            try {
              await fs.access(logoPath);
              const logoData = (await fs.readFile(logoPath)).toString('base64');
              const ratio = await getImageRatio(logoPath);
              const logoWidth = 42;
              const logoHeight = logoWidth / ratio;
              doc.addImage(`data:image/png;base64,${logoData}`, 'PNG', 143, sidebarY, logoWidth, logoHeight);
              sidebarY += logoHeight + 8;
            } catch (err) {}
          }
        }
        
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        const addressLines = doc.splitTextToSize(profile.contactAddress, 42);
        doc.text(addressLines, 143, sidebarY);
        sidebarY += (addressLines.length * 4) + 4;
        const personLines = doc.splitTextToSize(profile.contactPerson, 42);
        doc.text(personLines, 143, sidebarY);
        sidebarRendered = true;
      }
    }
    
    if (!sidebarRendered) {
      const sidebarPath = path.join(process.cwd(), 'public', 'SeitentextrechtsmitLogo.png');
      try {
        await fs.access(sidebarPath);
        const sidebarData = (await fs.readFile(sidebarPath)).toString('base64');
        doc.addImage(`data:image/png;base64,${sidebarData}`, 'PNG', 143, 35, 42, 63.8);
      } catch (err) {}
    }

    // 3. Sender / Receiver Address
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    const returnAddr = profile?.returnAddress || "Schulamt - Musterstr. 1 - 12345 Musterstadt";
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
    doc.text(`${profile?.city || "Musterstadt"}, ${today}`, 143, 110);

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

    for (let d = 1; d <= daysInMonth; d++) {
      const currentDate = new Date(year, month - 1, d);
      const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const displayDate = currentDate.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
      
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

    // 7. Signature Area
    const finalY = (doc as any).lastAutoTable.finalY || 200;
    
    let currentY = finalY + 20;

    if (profile?.signatureUrl) {
      const sigPath = safePublicPath(profile.signatureUrl);
      if (sigPath) {
        try {
          await fs.access(sigPath);
          const sigData = (await fs.readFile(sigPath)).toString('base64');
          const ratio = await getImageRatio(sigPath);
          const sigWidth = 45;
          const sigHeight = sigWidth / ratio;
          doc.addImage(`data:image/png;base64,${sigData}`, 'PNG', 25, currentY, sigWidth, sigHeight);
          currentY += sigHeight + 5;
        } catch (err) {
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
    doc.text(profile?.amtsleitungName || "Max Mustermann", 25, currentY);
    doc.text(profile?.amtsleitungTitle || "Schulamtsdirektor", 25, currentY + 5);

    const pdfBuffer = doc.output('arraybuffer');

    const sanitizedFileName = `Monatsuebersicht_${sanitizeFilenamePart(teacher.name)}_${yearStr}-${monthStr}.pdf`;

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${sanitizedFileName}"`
      }
    });

  } catch (error) {
    console.error('PDF Generation Error:', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
