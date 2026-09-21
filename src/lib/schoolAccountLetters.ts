import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import fs from 'fs/promises';
import { getImageRatioFromBuffer, getPdfImageFormatFromBuffer, safePublicPath } from '@/lib/pdfGenerator';

export type SchoolAccountLetter = {
  schoolName: string;
  email: string;
  initialPassword: string;
};

export type SchoolAccountLettersInput = {
  appUrl: string;
  accounts: SchoolAccountLetter[];
};

type PdfImage = { data: string; format: 'PNG' | 'JPEG'; ratio: number };

async function loadApplicationLogo(): Promise<PdfImage | null> {
  const logoPath = safePublicPath('/logo_transparent.png');
  if (!logoPath) return null;
  try {
    const data = await fs.readFile(logoPath);
    return {
      data: data.toString('base64'),
      format: getPdfImageFormatFromBuffer(data),
      ratio: getImageRatioFromBuffer(data),
    };
  } catch {
    // The letter remains usable when a deployment deliberately has no logo file.
    return null;
  }
}

function textHeight(doc: jsPDF, value: string, width: number, size: number): number {
  doc.setFontSize(size);
  return doc.splitTextToSize(value, width).length * size * 0.43;
}

/**
 * Creates one print-ready A4 page per school. The passwords only live in this
 * object until the route has returned the PDF response; callers must never log
 * or persist the input values.
 */
export async function createSchoolAccountLetters(input: SchoolAccountLettersInput): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const logo = await loadApplicationLogo();
  const loginUrl = new URL('/', input.appUrl).toString().replace(/\/$/, '');
  const qrUrl = `${loginUrl}/`;
  const qrImage = await QRCode.toDataURL(qrUrl, {
    errorCorrectionLevel: 'H',
    margin: 4,
    width: 900,
    color: { dark: '#111827', light: '#FFFFFFFF' },
  });

  for (const [index, account] of input.accounts.entries()) {
    if (index > 0) doc.addPage();
    const left = 20;
    const right = 190;
    const contentWidth = right - left;
    let y = 18;

    if (logo) {
      const logoHeight = Math.min(16, 45 / logo.ratio);
      doc.addImage(logo.data, logo.format, left, y, logoHeight * logo.ratio, logoHeight);
    }
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(20, 44, 85);
    doc.text('Zugang zum Mobile-Reserven-Portal', right, y + 8, { align: 'right' });
    doc.setDrawColor(70, 111, 167);
    doc.setLineWidth(0.5);
    doc.line(left, y + 21, right, y + 21);
    y += 32;

    doc.setTextColor(0, 0, 0);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10.5);
    const greeting = `Guten Tag,\n\nfür ${account.schoolName} wurde ein Zugang zum Mobile-Reserven-Portal eingerichtet. Bitte bewahren Sie dieses Schreiben vertraulich auf.`;
    const greetingLines = doc.splitTextToSize(greeting, contentWidth);
    doc.text(greetingLines, left, y);
    y += greetingLines.length * 4.7 + 7;

    const boxX = left;
    const boxY = y;
    const boxW = 108;
    const credentials = [
      ['Login-Seite', qrUrl],
      ['Benutzername / Login-E-Mail', account.email],
      ['Initialpasswort', account.initialPassword],
    ] as const;
    const credentialHeight = credentials.reduce(
      (sum, [, value]) => sum + Math.max(7, textHeight(doc, value, boxW - 10, 10) + 3) + 7,
      8,
    );
    const boxH = credentialHeight + 8;
    doc.setFillColor(243, 247, 252);
    doc.setDrawColor(174, 195, 221);
    doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'FD');
    let rowY = boxY + 9;
    for (const [label, value] of credentials) {
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8.6);
      doc.setTextColor(48, 76, 116);
      doc.text(label, boxX + 5, rowY);
      rowY += 4;
      doc.setFont('Helvetica', label === 'Initialpasswort' ? 'bold' : 'normal');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      const lines = doc.splitTextToSize(value, boxW - 10);
      doc.text(lines, boxX + 5, rowY);
      rowY += lines.length * 4.3 + 6;
    }

    const qrSize = 50;
    const qrX = right - qrSize;
    doc.addImage(qrImage, 'PNG', qrX, boxY, qrSize, qrSize);
    if (logo) {
      const markSize = 9;
      const markX = qrX + (qrSize - markSize) / 2;
      const markY = boxY + (qrSize - markSize) / 2;
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(markX - 1.2, markY - 1.2, markSize + 2.4, markSize + 2.4, 1, 1, 'F');
      doc.addImage(logo.data, logo.format, markX, markY, markSize, markSize / logo.ratio);
    }
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(48, 76, 116);
    doc.text('Direkt zur Login-Seite', qrX + qrSize / 2, boxY + qrSize + 5, { align: 'center' });

    y = Math.max(boxY + boxH, boxY + qrSize + 10) + 8;
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 44, 85);
    doc.text('Wichtig beim ersten Login', left, y);
    y += 6;
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    const instructions = 'Melden Sie sich mit der oben genannten Login-E-Mail und dem Initialpasswort an. Nach dem ersten Login müssen Sie ein eigenes Passwort vergeben. Geben Sie dieses Schreiben, insbesondere das Initialpasswort, nicht an Unbefugte weiter.';
    const instructionLines = doc.splitTextToSize(instructions, contentWidth);
    doc.text(instructionLines, left, y);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(96, 96, 96);
    doc.text('Dieses Zugangsschreiben enthält vertrauliche Zugangsdaten.', left, 281);
    doc.text(`Seite ${index + 1} von ${input.accounts.length}`, right, 281, { align: 'right' });
  }

  return new Uint8Array(doc.output('arraybuffer'));
}
