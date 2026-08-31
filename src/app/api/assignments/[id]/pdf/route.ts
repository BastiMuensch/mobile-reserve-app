import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { jsPDF } from 'jspdf';
import fs from 'fs/promises';

import { getSalutation, getImageRatio, getPdfImageFormat, safePublicPath, sanitizeFilenamePart } from '@/lib/pdfGenerator';
import { BAYTGV_LEGAL_TEXT } from '@/lib/onboarding';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Fetch the assignment details including teacher, request, target school, home school
    // and include the Schulamt managing this school with their profile configuration
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        teacher: {
          include: {
            stammschule: true
          }
        },
        request: {
          include: {
            school: {
              include: {
                schulamt: {
                  include: {
                    schulamtProfile: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Authorization Guard
    const isTeacherOwner = userSession.role === 'TEACHER' && userSession.teachers?.some(t => t.id === assignment.teacherId);
    const isSchoolParty = userSession.role === 'SCHOOL' && (
      assignment.request.schoolId === userSession.schoolId || 
      assignment.teacher.stammschuleId === userSession.schoolId
    );
    const isSchulamtManager = userSession.role === 'SCHULAMT' && (
      assignment.request.school.schulamtId === userSession.id ||
      assignment.teacher.stammschule.schulamtId === userSession.id
    );
    const isAdmin = userSession.role === 'ADMIN';

    if (!isTeacherOwner && !isSchoolParty && !isSchulamtManager && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Schulamt Profile resolution
    const profile = assignment.request.school.schulamt?.schulamtProfile;
    const requiredProfileFields = profile && [profile.headerText, profile.returnAddress, profile.contactAddress, profile.contactPerson, profile.city, profile.amtsleitungName, profile.amtsleitungTitle, profile.documentSubject, profile.documentIntro, profile.documentLegalText, profile.documentClosing];
    if (!profile || requiredProfileFields?.some(value => !value.trim())) {
      return NextResponse.json({ error: 'Das Schulamtsprofil ist unvollständig. Bitte Briefkopf und Dokumenttexte zuerst einrichten.' }, { status: 409 });
    }

    // Format the date for the file and letter
    const deploymentDate = new Date(assignment.date);
    const formattedDate = deploymentDate.toLocaleDateString('de-DE');

    // Parse teacher name to extract first name and last name
    const nameParts = assignment.teacher.name.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Vorname';
    const lastName = nameParts.slice(1).join(' ') || 'Nachname';
    const sanitizedFileName = `${sanitizeFilenamePart(firstName)}_${sanitizeFilenamePart(lastName)}_${formattedDate}.pdf`;

    // Duration handling (detect single vs multi-day range)
    const startDateStr = new Date(assignment.date).toLocaleDateString('de-DE');
    let durationStr = startDateStr;
    if (assignment.request.isOpenEnded && !assignment.request.endDate) {
      // Krankmeldung ohne bekanntes Ende: Ein Einzeldatum wäre irreführend, denn die
      // Abordnung gilt bis zur Rückkehr der vertretenen Lehrkraft.
      durationStr = `ab ${startDateStr}, Ende offen`;
    } else if (assignment.request.endDate) {
      const endDateStr = new Date(assignment.request.endDate).toLocaleDateString('de-DE');
      if (endDateStr !== startDateStr) {
        durationStr = `${startDateStr} bis ${endDateStr}`;
      }
    }

    // Initialize jsPDF document (standard A4 size, portrait mode, units in mm)
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text(doc.splitTextToSize(profile.headerText, 110), 25, 20);

    // 2. Right Side Contact Panel (Sidebar)
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
          console.error('Failed to add custom logo image to PDF:', error);
        }
      }
    }
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    const addressLines = doc.splitTextToSize(profile.contactAddress, 42);
    doc.text(addressLines, 143, sidebarY);
    sidebarY += (addressLines.length * 4) + 6;
    doc.text(doc.splitTextToSize(profile.contactPerson, 42), 143, sidebarY);

    // 3. Small return address line (Rücksendeangabe) above the recipient block
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(profile.returnAddress, 25, 43);
    
    // Draw separation line
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.line(25, 44, 110, 44);
    
    doc.setTextColor(0, 0, 0);

    // 4. Recipient Address Block (Teacher's home address)
    const { salutation, honorific } = getSalutation(firstName, lastName, assignment.teacher.gender);
    doc.setFontSize(9);
    doc.text(honorific || 'Frau/Herrn', 25, 52);
    
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(assignment.teacher.name, 25, 58);
    
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    
    const teacherAddress = assignment.teacher.address || '';
    const addressParts = teacherAddress.split(',');
    const street = addressParts[0]?.trim() || '';
    const city = addressParts[1]?.trim() || '';
    
    doc.text(street, 25, 64);
    if (city) {
      doc.text(city, 25, 69);
    }

    // 5. Document Date (below the recipient address block, left-aligned)
    doc.setFontSize(9);
    const todayFormatted = new Date().toLocaleDateString('de-DE');
    doc.text(`${profile.city}, den ${todayFormatted}`, 25, 82);

    // 6. Subject Line
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    const subjectLines = doc.splitTextToSize(profile.documentSubject, 160);
    doc.text(subjectLines, 25, 110);

    // 7. Letter Body and Deployment Details
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    
    const salutationY = 110 + subjectLines.length * 5 + 10;
    doc.text(salutation, 25, salutationY);
    const introY = salutationY + 8;
    const introLines = doc.splitTextToSize(profile.documentIntro, 160);
    doc.text(introLines, 25, introY);

    // Render deployment details in a clean key-value layout with dynamic Y coordinate wrapping
    let currentY = introY + introLines.length * 5 + 10;
    
    const details = [
      { label: 'Von (Stammschule):', value: `${assignment.teacher.stammschule.name}, ${assignment.teacher.stammschule.address}` },
      { label: 'An (Schule):', value: `${assignment.request.school.name}, ${assignment.request.school.address}` },
      { label: 'Name der zu vertretenden Lehrkraft:', value: assignment.request.substitutedTeacher || '-' },
      { label: 'Dauer der Vertretung:', value: durationStr },
      { label: 'Stundenzahl:', value: `${assignment.hours} Std. (ab ${assignment.request.startHour}. Std)` },
      { label: 'Grund für die Vertretung:', value: assignment.request.priority === 'UNPLANNED_ABSENCE' ? 'Ungeplanter Ausfall' : (assignment.request.priority || 'Ungeplanter Ausfall') }
    ];

    details.forEach((item) => {
      // Draw Label at X=25
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(item.label, 25, currentY);
      
      // Draw Value at X=90, wrapped to width 95 (from X=90 to X=185)
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(10);
      const splitValue = doc.splitTextToSize(item.value, 95);
      doc.text(splitValue, 90, currentY);
      
      const lineCount = splitValue.length;
      currentY += (lineCount * 5) + 3;
    });

    // 8. Disclaimer & Legal Text
    const disclaimerY = currentY + 5;
    doc.setFontSize(9);
    let legalBottomY = disclaimerY;
    for (const [index, paragraph] of BAYTGV_LEGAL_TEXT.split(/\n\n+/).entries()) {
      doc.setFont('Helvetica', index === 0 ? 'bold' : 'normal');
      const legalLines = doc.splitTextToSize(paragraph, 160);
      doc.text(legalLines, 25, legalBottomY);
      legalBottomY += legalLines.length * 4.5 + 4;
    }

    // 9. Signature Block
    const signatureY = legalBottomY + 8;
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(profile.documentClosing, 25, signatureY);
    
    // Load and embed hand-written signature (Unterschrift.png or custom signatureUrl)
    let sigPath: string | null = null;
    if (profile.signatureUrl) {
      const safeSigPath = safePublicPath(profile.signatureUrl);
      if (safeSigPath) {
        try {
          await fs.access(safeSigPath);
          sigPath = safeSigPath;
        } catch {
          // Keine Grafik rendern; Textsignatur bleibt erhalten.
        }
      } else {
        console.warn('Blocked path traversal attempt in signatureUrl:', profile.signatureUrl);
      }
    }

    let sigOffset = 16;
    try {
      if (!sigPath) throw new Error('Keine Unterschrift hinterlegt');
      await fs.access(sigPath);
      const sigData = (await fs.readFile(sigPath)).toString('base64');
      const ratio = await getImageRatio(sigPath);
      const format = await getPdfImageFormat(sigPath);
      const sigWidth = 35;
      const sigHeight = sigWidth / ratio;
      doc.addImage(`data:image/${format === 'PNG' ? 'png' : 'jpeg'};base64,${sigData}`, format, 25, signatureY + 3, sigWidth, sigHeight);
      sigOffset = sigHeight + 6; // Push printed text down dynamically
    } catch (err) {
      console.error('Failed to add signature image to PDF:', err);
    }
    
    const signeeName = profile.amtsleitungName;
    const signeeTitle = profile.amtsleitungTitle;

    doc.setFont('Helvetica', 'bold');
    doc.text(signeeName, 25, signatureY + sigOffset);
    doc.setFont('Helvetica', 'normal');
    doc.text(signeeTitle, 25, signatureY + sigOffset + 5);

    // Stream arraybuffer output to the response
    const pdfOutput = doc.output('arraybuffer');
    
    return new Response(pdfOutput, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${sanitizedFileName}"`
      }
    });

  } catch (error) {
    console.error('Error generating deployment proof PDF:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
