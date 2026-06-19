import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { jsPDF } from 'jspdf';
import fs from 'fs/promises';
import path from 'path';

// Resolves a relative URL path to a safe absolute path within public/.
// Prevents path traversal attacks by ensuring the resolved path stays inside public/.
function safePublicPath(relativePath: string): string | null {
  const publicDir = path.join(process.cwd(), 'public');
  const resolved = path.resolve(publicDir, relativePath.replace(/^\/+/, ''));
  if (!resolved.startsWith(publicDir + path.sep) && resolved !== publicDir) {
    return null; // Path traversal attempt
  }
  return resolved;
}

// Helper to sanitize filenames according to German spelling and avoid encoding issues in HTTP headers
function sanitizeFilenamePart(text: string): string {
  return text
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_');
}

function getSalutation(firstName: string, lastName: string, gender?: string | null): { salutation: string; honorific: string } {
  let isFemale: boolean;
  
  if (gender === 'FEMALE') {
    isFemale = true;
  } else if (gender === 'MALE') {
    isFemale = false;
  } else if (gender === 'DIVERSE') {
    // Diverse: use neutral form without Herr/Frau
    return { salutation: `Sehr geehrte/r ${firstName} ${lastName},`, honorific: '' };
  } else {
    // Fallback heuristic when gender is not set
    const fLower = firstName.toLowerCase();
    const femaleNames = [
      'anna', 'julia', 'sabine', 'lisa', 'maria', 'petra', 'tanja', 'sarah', 'laura', 
      'melanie', 'christina', 'karen', 'karin', 'monika', 'ursula', 'nicole', 
      'daniela', 'heike', 'susanne', 'brigitte', 'claudia', 'angelika', 'barbara', 
      'gabriele', 'elisabeth', 'renate', 'ingrid', 'gisela', 'helga', 'hannelore',
      'tamara', 'frauke', 'antje', 'katrin', 'stefanie', 'steffi', 'christiane',
      'anja', 'kathrin', 'ulrike', 'verena', 'sandra', 'nadine', 'sonja'
    ];
    isFemale = femaleNames.includes(fLower) || 
               (fLower.endsWith('a') && !['luca', 'mika', 'mustafa'].includes(fLower)) || 
               (fLower.endsWith('e') && !['rene', 'uwe', 'pepe', 'basti'].includes(fLower));
  }
  
  if (isFemale) {
    return { salutation: `Sehr geehrte Frau ${lastName},`, honorific: 'Frau' };
  } else {
    return { salutation: `Sehr geehrter Herr ${lastName},`, honorific: 'Herrn' };
  }
}

// Parses PNG or JPEG dimension headers to calculate image aspect ratio.
// Reads only a small header buffer (64 KB) instead of the entire file for efficiency.
async function getImageRatio(filePath: string): Promise<number> {
  let fd: fs.FileHandle | null = null;
  try {
    fd = await fs.open(filePath, 'r');
    const headerBuf = Buffer.alloc(65536); // 64 KB is enough for any image header
    const { bytesRead } = await fd.read(headerBuf, 0, 65536, 0);
    const buffer = headerBuf.subarray(0, bytesRead);
    
    // PNG format check
    if (bytesRead >= 24 && buffer.readUInt32BE(0) === 0x89504E47 && buffer.readUInt32BE(4) === 0x0D0A1A0A) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (height > 0) return width / height;
    }
    // JPEG format check
    if (bytesRead >= 2 && buffer.readUInt16BE(0) === 0xFFD8) {
      let offset = 2;
      while (offset + 4 < bytesRead) {
        const marker = buffer.readUInt16BE(offset);
        offset += 2;
        if (marker === 0xFFC0 || marker === 0xFFC2) { // SOF0 or SOF2
          if (offset + 7 <= bytesRead) {
            const height = buffer.readUInt16BE(offset + 3);
            const width = buffer.readUInt16BE(offset + 5);
            if (height > 0) return width / height;
          }
          break;
        }
        if (offset + 2 > bytesRead) break;
        const length = buffer.readUInt16BE(offset);
        if (length < 2) break; // Corrupt marker – prevent infinite loop
        offset += length;
      }
    }
  } catch (e) {
    console.error('Failed to parse image ratio:', e);
  } finally {
    if (fd) await fd.close();
  }
  return 1.0; // Fallback ratio
}

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
    if (assignment.request.endDate) {
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

    // 1. Header (Kopfzeile)
    // If there is no custom header Text and no custom logo, render default image banner Kopfzeile.png
    const isDefaultHeader = !profile || profile.headerText === "Staatliches Schulamt Musterstadt" || profile.headerText === "Staatliche Schulämter im Landkreis Unterallgäu und in der Stadt Memmingen";
    let headerRendered = false;
    
    if (isDefaultHeader && !profile?.logoUrl) {
      const headerPath = path.join(process.cwd(), 'public', 'Kopfzeile.png');
      try {
        await fs.access(headerPath);
        const headerData = (await fs.readFile(headerPath)).toString('base64');
        // Image dimensions: 1298x62 => Aspect ratio ~20.93 => 160mm width / 7.64mm height
        doc.addImage(`data:image/png;base64,${headerData}`, 'PNG', 25, 15, 160, 7.64);
        headerRendered = true;
      } catch (err) {
        console.error('Failed to add header image to PDF:', err);
      }
    }

    if (!headerRendered && profile) {
      // Print customized header text at the top
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(100, 100, 100);
      const splitHeader = doc.splitTextToSize(profile.headerText, 110);
      doc.text(splitHeader, 25, 20);
    }

    // 2. Right Side Contact Panel (Sidebar)
    let sidebarRendered = false;
    if (profile) {
      const isDefaultAddress = profile.contactAddress.includes("Memminger Str. 18") && profile.contactAddress.includes("87719 Mindelheim");
      const isDefaultPerson = profile.contactPerson.includes("Tamara Schmidt") && profile.contactPerson.includes("Durchwahl");
      
      // If they have customized the logo, address, or contact person, render dynamically.
      // Otherwise, render high-quality SeitentextrechtsmitLogo.png fallback.
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
              // Renders logo at top right of sidebar
              doc.addImage(`data:image/png;base64,${logoData}`, 'PNG', 143, sidebarY, logoWidth, logoHeight);
              sidebarY += logoHeight + 8;
            } catch (err) {
              console.error('Failed to add custom logo image to PDF:', err);
            }
          } else {
            console.warn('Blocked path traversal attempt in logoUrl:', profile.logoUrl);
          }
        }
        
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        
        const addressLines = doc.splitTextToSize(profile.contactAddress, 42);
        doc.text(addressLines, 143, sidebarY);
        sidebarY += (addressLines.length * 4) + 6;
        
        const personLines = doc.splitTextToSize(profile.contactPerson, 42);
        doc.text(personLines, 143, sidebarY);
        
        sidebarRendered = true;
      }
    }

    // Fallback to static image sidebar if not dynamically rendered
    if (!sidebarRendered) {
      const rightPanelPath = path.join(process.cwd(), 'public', 'SeitentextrechtsmitLogo.png');
      try {
        await fs.access(rightPanelPath);
        const rightPanelData = (await fs.readFile(rightPanelPath)).toString('base64');
        // Image dimensions: 568x736 => Aspect ratio ~0.7717 => 42mm width / 54.42mm height
        doc.addImage(`data:image/png;base64,${rightPanelData}`, 'PNG', 143, 35, 42, 54.42);
      } catch (err) {
        console.error('Failed to add right contact panel image to PDF:', err);
      }
    }

    // 3. Small return address line (Rücksendeangabe) above the recipient block
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    const returnAddressLine = profile?.returnAddress || 'Staatliches Schulamt Musterstadt - Musterstr. 1 - 12345 Musterstadt';
    doc.text(returnAddressLine, 25, 43);
    
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
    const docCity = profile?.city || 'Mindelheim';
    doc.text(`${docCity}, den ${todayFormatted}`, 25, 82);

    // 6. Subject Line
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Verwendung als mobile Reserve innerhalb des Schulamtsbereiches', 25, 110);

    // 7. Letter Body and Deployment Details
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    
    doc.text(salutation, 25, 122);
    
    doc.text('zur Verwendung als mobile Reserve werden Sie wie folgt eingesetzt:', 25, 130);

    // Render deployment details in a clean key-value layout with dynamic Y coordinate wrapping
    let currentY = 140;
    
    const details = [
      { label: 'Von (Stammschule):', value: `${assignment.teacher.stammschule.name}, ${assignment.teacher.stammschule.address}` },
      { label: 'An (Schule):', value: `${assignment.request.school.name}, ${assignment.request.school.address}` },
      { label: 'Name der zu vertretenden Lehrkraft:', value: assignment.request.substitutedTeacher || '-' },
      { label: 'Dauer der Vertretung:', value: durationStr },
      { label: 'Stundenzahl:', value: `${assignment.hours} Std. (ab ${assignment.request.startHour}. Std)` },
      { label: 'Grund für die Vertretung:', value: assignment.request.priority === 'ERKRANKUNG' ? 'Ungeplanter Ausfall' : (assignment.request.priority || 'Ungeplanter Ausfall') }
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
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Umzugskostenvergütung wird nicht zugesagt.', 25, disclaimerY);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    const p1 = 'Bei einer Abordnung an einen Ort außerhalb des Dienst- oder Wohnortes ohne Zusage der Umzugskostenvergütung erhalten Sie auf Antrag Trennungsgeld (Entschädigung bei täglicher Rückkehr zum Wohnort) nach der BayTGV (Art. 22 Abs. 1 BayRKG i. V. m. § 1 Abs. 1 Nr. 3 BayTGV).';
    const p2 = 'Einem etwaigen Antrag auf Trennungsgeld ist dieses Abordnungsschreiben (ggf. Ablichtung) beizufügen.';
    
    const splitP1 = doc.splitTextToSize(p1, 160);
    const splitP2 = doc.splitTextToSize(p2, 160);
    
    doc.text(splitP1, 25, disclaimerY + 8);
    const p2Y = disclaimerY + 8 + (splitP1.length * 4.5) + 4;
    doc.text(splitP2, 25, p2Y);

    // 9. Signature Block
    const signatureY = p2Y + (splitP2.length * 4.5) + 12;
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Mit freundlichen Grüßen', 25, signatureY);
    
    // Load and embed hand-written signature (Unterschrift.png or custom signatureUrl)
    let sigPath = path.join(process.cwd(), 'public', 'Unterschrift.png');
    if (profile?.signatureUrl) {
      const safeSigPath = safePublicPath(profile.signatureUrl);
      if (safeSigPath) {
        try {
          await fs.access(safeSigPath);
          sigPath = safeSigPath;
        } catch {
          // Custom signature file not found, fall back to default
        }
      } else {
        console.warn('Blocked path traversal attempt in signatureUrl:', profile.signatureUrl);
      }
    }

    let sigOffset = 16;
    try {
      await fs.access(sigPath);
      const sigData = (await fs.readFile(sigPath)).toString('base64');
      const ratio = await getImageRatio(sigPath);
      const sigWidth = 35;
      const sigHeight = sigWidth / ratio;
      doc.addImage(`data:image/png;base64,${sigData}`, 'PNG', 25, signatureY + 3, sigWidth, sigHeight);
      sigOffset = sigHeight + 6; // Push printed text down dynamically
    } catch (err) {
      console.error('Failed to add signature image to PDF:', err);
    }
    
    const signeeName = profile?.amtsleitungName || 'Ursula Abt';
    const signeeTitle = profile?.amtsleitungTitle || 'Schulamtsdirektorin';

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
