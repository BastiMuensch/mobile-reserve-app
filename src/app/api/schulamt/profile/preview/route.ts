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
    const salutation = "Sehr geehrter Herr Mustermann,";
    const hours = 5;
    const startHour = 1;
    const substitutedTeacher = "Frau Meier";

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const isDefaultHeader = !profile.headerText || profile.headerText === "Staatliches Schulamt Musterstadt" || profile.headerText === "Staatliche Schulämter im Landkreis Unterallgäu und in der Stadt Memmingen";
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
    const isDefaultAddress = contactAddress.includes("Musterstr. 1") && contactAddress.includes("12345 Musterstadt");
    const isDefaultPerson = contactPerson.includes("Max Mustermann") && contactPerson.includes("Durchwahl");
    
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

    // 3. Small return address line (Rücksendeangabe) above the recipient block
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    const returnAddressLine = profile.returnAddress || 'Staatliches Schulamt Musterstadt - Musterstr. 1 - 12345 Musterstadt';
    doc.text(returnAddressLine, 25, 43);

    // Draw separation line
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.line(25, 44, 110, 44);

    doc.setTextColor(0, 0, 0);

    // 4. Recipient Address Block
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);

    doc.text('Frau/Herrn', 25, 52);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(teacherName, 25, 58);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Musterstraße 1', 25, 64);
    doc.text('12345 Musterstadt', 25, 69);

    // 5. Document Date
    doc.setFontSize(9);
    const docCity = profile.city || 'Mindelheim';
    doc.text(`${docCity}, den ${formattedDate}`, 25, 82);

    // 6. Subject Line
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Verwendung als mobile Reserve innerhalb des Schulamtsbereiches', 25, 110);

    // 7. Letter Body and Deployment Details
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(salutation, 25, 122);
    doc.text('zur Verwendung als mobile Reserve werden Sie wie folgt eingesetzt:', 25, 130);

    let currentY = 140;
    const details = [
      { label: 'Von (Stammschule):', value: `Muster-Stammschule, Stammschulweg 1` },
      { label: 'An (Schule):', value: `Muster-Zielschule, Zielweg 2` },
      { label: 'Name der zu vertretenden Lehrkraft:', value: substitutedTeacher },
      { label: 'Dauer der Vertretung:', value: durationStr },
      { label: 'Stundenzahl:', value: `${hours} Std. (ab ${startHour}. Std)` },
      { label: 'Grund für die Vertretung:', value: 'Ungeplanter Ausfall' }
    ];

    details.forEach((item) => {
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(item.label, 25, currentY);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(10);
      const splitValue = doc.splitTextToSize(item.value, 95);
      doc.text(splitValue, 90, currentY);
      currentY += (splitValue.length * 5) + 3;
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

    let signatureRendered = false;
    let sigOffset = 16;
    if (profile.signatureUrl) {
      const sigPath = safePublicPath(profile.signatureUrl);
      if (sigPath) {
        try {
          await fs.access(sigPath);
          const sigData = (await fs.readFile(sigPath)).toString('base64');
          const sigRatio = await getImageRatio(sigPath);
          const sigWidth = 35;
          const sigHeight = sigWidth / sigRatio;
          doc.addImage(`data:image/png;base64,${sigData}`, 'PNG', 25, signatureY + 3, sigWidth, sigHeight);
          sigOffset = sigHeight + 6;
          signatureRendered = true;
        } catch (err) {}
      }
    }

    if (!signatureRendered) {
      const defSigPath = path.join(process.cwd(), 'public', 'Unterschrift.png');
      try {
        await fs.access(defSigPath);
        const defSigData = (await fs.readFile(defSigPath)).toString('base64');
        doc.addImage(`data:image/png;base64,${defSigData}`, 'PNG', 25, signatureY + 3, 35, 17.5);
        sigOffset = 23.5;
      } catch (err) {}
    }

    doc.setFont('Helvetica', 'bold');
    doc.text(profile.amtsleitungName || "Ursula Abt", 25, signatureY + sigOffset);
    doc.setFont('Helvetica', 'normal');
    doc.text(profile.amtsleitungTitle || "Schulamtsdirektorin", 25, signatureY + sigOffset + 5);

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
