import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { jsPDF } from 'jspdf';
import fs from 'fs/promises';
import path from 'path';

// Helper functions (same as in pdf/route.ts)
function safePublicPath(relativePath: string): string | null {
  const publicDir = path.join(process.cwd(), 'public');
  const resolved = path.resolve(publicDir, relativePath.replace(/^\/+/, ''));
  if (!resolved.startsWith(publicDir + path.sep) && resolved !== publicDir) {
    return null;
  }
  return resolved;
}

async function getImageRatio(filePath: string): Promise<number> {
  let fd: fs.FileHandle | null = null;
  try {
    fd = await fs.open(filePath, 'r');
    const headerBuf = Buffer.alloc(65536);
    const { bytesRead } = await fd.read(headerBuf, 0, 65536, 0);
    const buffer = headerBuf.subarray(0, bytesRead);
    
    if (bytesRead >= 24 && buffer.readUInt32BE(0) === 0x89504E47 && buffer.readUInt32BE(4) === 0x0D0A1A0A) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (height > 0) return width / height;
    }
    if (bytesRead >= 2 && buffer.readUInt16BE(0) === 0xFFD8) {
      let offset = 2;
      while (offset + 4 < bytesRead) {
        const marker = buffer.readUInt16BE(offset);
        offset += 2;
        if (marker === 0xFFC0 || marker === 0xFFC2) {
          if (offset + 7 <= bytesRead) {
            const height = buffer.readUInt16BE(offset + 3);
            const width = buffer.readUInt16BE(offset + 5);
            if (height > 0) return width / height;
          }
          break;
        }
        if (offset + 2 > bytesRead) break;
        const length = buffer.readUInt16BE(offset);
        if (length < 2) break;
        offset += length;
      }
    }
  } catch (e) {
    console.error('Failed to parse image ratio:', e);
  } finally {
    if (fd) await fd.close();
  }
  return 1.0;
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get profile data from request body instead of database
    const profile = await request.json();

    // Dummy Assignment Data
    const formattedDate = new Date().toLocaleDateString('de-DE');
    const durationStr = formattedDate;
    const teacherName = "Max Mustermann";
    const firstName = "Max";
    const lastName = "Mustermann";
    const targetSchoolName = "Muster-Grundschule";
    const homeSchoolName = "Stammschule Musterstadt";
    const salutation = "Sehr geehrter Herr Mustermann,";
    const hours = 5;
    const startHour = 1;
    const schoolType = "GRUNDSCHULE";
    const substitutedTeacher = "Frau Meier";

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const isDefaultHeader = !profile.headerText || profile.headerText === "Staatliche Schulämter im Landkreis Unterallgäu und in der Stadt Memmingen";
    let headerRendered = false;
    
    if (isDefaultHeader && !profile.logoUrl) {
      const headerPath = path.join(process.cwd(), 'public', 'Kopfzeile.png');
      try {
        await fs.access(headerPath);
        const headerData = (await fs.readFile(headerPath)).toString('base64');
        doc.addImage(`data:image/png;base64,${headerData}`, 'PNG', 25, 15, 160, 7.64);
        headerRendered = true;
      } catch (err) {
        console.error('Failed to add header image to PDF:', err);
      }
    }

    if (!headerRendered) {
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(100, 100, 100);
      const splitHeader = doc.splitTextToSize(profile.headerText || "", 110);
      doc.text(splitHeader, 25, 20);
    }

    let sidebarRendered = false;
    const contactAddress = profile.contactAddress || "";
    const contactPerson = profile.contactPerson || "";
    const isDefaultAddress = contactAddress.includes("Memminger Str. 18") && contactAddress.includes("87719 Mindelheim");
    const isDefaultPerson = contactPerson.includes("Tamara Schmidt") && contactPerson.includes("Durchwahl");
    
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
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      
      const splitAddress = doc.splitTextToSize(contactAddress, 42);
      doc.text(splitAddress, 143, sidebarY);
      sidebarY += (splitAddress.length * 3.5) + 6;

      doc.setFont('Helvetica', 'bold');
      doc.text("Ihr Ansprechpartner", 143, sidebarY);
      sidebarY += 4;
      doc.setFont('Helvetica', 'normal');
      const splitPerson = doc.splitTextToSize(contactPerson, 42);
      doc.text(splitPerson, 143, sidebarY);
      
      sidebarRendered = true;
    }

    if (!sidebarRendered) {
      const sidebarPath = path.join(process.cwd(), 'public', 'SeitentextrechtsmitLogo.png');
      try {
        await fs.access(sidebarPath);
        const sidebarData = (await fs.readFile(sidebarPath)).toString('base64');
        doc.addImage(`data:image/png;base64,${sidebarData}`, 'PNG', 135, 35, 55, 114);
      } catch (err) {}
    }

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);

    const addressBlock = [
      teacherName,
      "Lehrkraft",
      "Stammschule:",
      homeSchoolName
    ];
    doc.text(addressBlock, 25, 55);

    const dateStrObj = new Date();
    doc.text(`${profile.locationText || 'Ort'}, den ${formattedDate}`, 185, 95, { align: 'right' });

    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Zuweisung als Mobile Reserve – Vorschau`, 25, 115);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(salutation, 25, 130);

    const introText = `hiermit weise ich Sie für den Zeitraum vom ${durationStr} der ${targetSchoolName} zu.`;
    const splitIntro = doc.splitTextToSize(introText, 160);
    doc.text(splitIntro, 25, 140);

    let yPos = 140 + (splitIntro.length * 5) + 5;

    doc.setFont('Helvetica', 'bold');
    doc.text("Einsatzdetails:", 25, yPos);
    doc.setFont('Helvetica', 'normal');
    
    yPos += 7;
    doc.text(`• Zielschule: ${targetSchoolName}`, 30, yPos);
    yPos += 6;
    doc.text(`• Schulart: ${schoolType}`, 30, yPos);
    yPos += 6;
    doc.text(`• Zu vertreten: ${substitutedTeacher}`, 30, yPos);
    yPos += 6;
    doc.text(`• Stundenumfang: ${hours} Unterrichtsstunde(n)`, 30, yPos);
    yPos += 6;
    doc.text(`• Beginn: ab der ${startHour}. Stunde`, 30, yPos);

    yPos += 15;
    const outtroText = `Bitte setzen Sie sich bezüglich des genauen Stundenplans rechtzeitig mit der Zielschule in Verbindung.\n\nIch danke Ihnen für Ihre Einsatzbereitschaft.`;
    const splitOuttro = doc.splitTextToSize(outtroText, 160);
    doc.text(splitOuttro, 25, yPos);

    yPos += (splitOuttro.length * 5) + 10;
    doc.text("Mit freundlichen Grüßen", 25, yPos);

    let signatureRendered = false;
    if (profile.signatureUrl) {
      const sigPath = safePublicPath(profile.signatureUrl);
      if (sigPath) {
        try {
          await fs.access(sigPath);
          const sigData = (await fs.readFile(sigPath)).toString('base64');
          const sigRatio = await getImageRatio(sigPath);
          const sigWidth = 40;
          const sigHeight = sigWidth / sigRatio;
          doc.addImage(`data:image/png;base64,${sigData}`, 'PNG', 25, yPos + 5, sigWidth, sigHeight);
          yPos += sigHeight + 5;
          signatureRendered = true;
        } catch (err) {}
      }
    }

    if (!signatureRendered) {
      const defSigPath = path.join(process.cwd(), 'public', 'Unterschrift.png');
      try {
        await fs.access(defSigPath);
        const defSigData = (await fs.readFile(defSigPath)).toString('base64');
        doc.addImage(`data:image/png;base64,${defSigData}`, 'PNG', 25, yPos + 5, 40, 20);
        yPos += 25;
      } catch (err) {
        yPos += 20; // Fallback space if missing
      }
    }

    yPos += 5;
    doc.text(profile.amtsleitungName || "Ursula Abt", 25, yPos);
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(profile.amtsleitungTitle || "Schulamtsdirektorin", 25, yPos + 5);

    const pdfBuffer = doc.output('arraybuffer');

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Vorschau.pdf"',
      },
    });

  } catch (error) {
    console.error('Error generating preview PDF:', error);
    return NextResponse.json({ error: 'Failed to generate preview PDF' }, { status: 500 });
  }
}
