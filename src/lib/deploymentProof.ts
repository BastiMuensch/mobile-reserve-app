import { jsPDF } from 'jspdf';
import fs from 'fs/promises';
import { BAYTGV_LEGAL_TEXT } from './onboarding';
import { getSalutation, safeMediaPath, safePublicPath, getImageRatioFromBuffer, getPdfImageFormatFromBuffer } from './pdfGenerator';
import { type ProofAssignment, formatProofDate } from './assignmentSeries';

export interface DeploymentProofInput {
  teacher: { name: string; address: string | null; gender?: string | null; stammschule: { name: string; address: string } };
  school: { name: string; address: string };
  profile: { headerText: string; returnAddress: string; contactAddress: string; contactPerson: string; city: string; documentSubject: string; documentIntro: string; documentClosing: string; amtsleitungName: string; amtsleitungTitle: string; logoUrl: string | null; signatureUrl: string | null };
  assignments: ProofAssignment[];
  substitutedTeacher: string | null;
  priority: string;
  now?: Date;
}

async function loadImage(url: string | null, isSignature = false) {
  if (!url) return null;
  const file = isSignature ? safeMediaPath(url) : safePublicPath(url);
  if (!file) return null;
  try {
    const data = await fs.readFile(file);
    return { data: data.toString('base64'), ratio: getImageRatioFromBuffer(data), format: getPdfImageFormatFromBuffer(data) };
  } catch { return null; }
}

/** The same renderer is used by the endpoint and visual regression fixtures. */
export async function createDeploymentProof(input: DeploymentProofInput): Promise<jsPDF> {
  const { teacher, school, profile, assignments } = input;
  if (!assignments.length) throw new Error('Keine Einsatztage für den Nachweis.');
  const cancelled = assignments.every(a => a.status === 'REJECTED');
  const [logo, signature] = await Promise.all([loadImage(profile.logoUrl), loadImage(profile.signatureUrl, true)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const left = 25;
  const width = 160;
  const bottom = 274;
  let y = 20;

  function ensure(height: number) {
    if (y + height <= bottom) return;
    doc.addPage(); y = 22;
  }
  function text(value: string, size = 10, bold = false, gap = 4) {
    doc.setFont('Helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(value, width);
    const step = size * .45;
    for (const line of lines) { ensure(step); doc.text(line, left, y); y += step; }
    y += gap;
  }

  const parts = teacher.name.trim().split(/\s+/);
  const { salutation, honorific } = getSalutation(parts[0] || '', parts.slice(1).join(' '), teacher.gender || undefined);
  const recipientAddress = (teacher.address || '').replace(/,\s*/g, '\n');
  // Extreme configured values use a flowing header instead of overflowing
  // either fixed-width address column. Ordinary letters retain the layout.
  doc.setFontSize(11);
  const leftLineCount = [profile.headerText, profile.returnAddress, teacher.name, recipientAddress]
    .reduce((sum, value) => sum + doc.splitTextToSize(value, 105).length, 0);
  doc.setFontSize(8);
  const sideLineCount = [profile.contactAddress, profile.contactPerson]
    .reduce((sum, value) => sum + doc.splitTextToSize(value, 42).length, 0);
  if (leftLineCount > 28 || sideLineCount > 40) {
    if (logo) {
      const h = Math.min(30, 42 / logo.ratio);
      doc.addImage(logo.data, logo.format, left, y, h * logo.ratio, h);
      y += h + 6;
    }
    text(profile.headerText, 11, true);
    text(profile.returnAddress, 8);
    text(profile.contactAddress, 9);
    text(profile.contactPerson, 9);
    text(honorific || 'Frau/Herrn', 9, false, 0);
    text(teacher.name, 10, true, 0);
    text(recipientAddress, 9, false, 8);
  } else {
  // Two independent header columns; the body starts beneath both.
  doc.setFont('Helvetica', 'bold'); doc.setFontSize(11);
  const headerLines: string[] = doc.splitTextToSize(profile.headerText, 105);
  doc.text(headerLines, left, y);
  y = Math.max(43, 20 + headerLines.length * 5 + 8);
  doc.setFont('Helvetica', 'normal'); doc.setFontSize(7);
  const returnLines: string[] = doc.splitTextToSize(profile.returnAddress, 105);
  doc.text(returnLines, left, y);
  y += returnLines.length * 3.5 + 4;
  doc.setFontSize(9); doc.text(honorific || 'Frau/Herrn', left, y); y += 6;
  doc.setFont('Helvetica', 'bold');
  const nameLines: string[] = doc.splitTextToSize(teacher.name, 105);
  doc.text(nameLines, left, y); y += nameLines.length * 4.5 + 2;
  doc.setFont('Helvetica', 'normal');
  const recipientLines: string[] = doc.splitTextToSize(recipientAddress, 105);
  doc.text(recipientLines, left, y); y += recipientLines.length * 4.5 + 10;

  let sideY = 22;
  if (logo) {
    const h = Math.min(30, 42 / logo.ratio); const w = h * logo.ratio;
    doc.addImage(logo.data, logo.format, 143, sideY, w, h); sideY += h + 6;
  }
  doc.setFontSize(8);
  for (const value of [profile.contactAddress, profile.contactPerson]) {
    const lines: string[] = doc.splitTextToSize(value, 42);
    doc.text(lines, 143, sideY); sideY += lines.length * 3.6 + 4;
  }
  y = Math.max(94, y, sideY + 8);
  }
  text(`${profile.city}, den ${formatProofDate(input.now || new Date())}`, 9, false, 8);
  if (cancelled) {
    doc.setTextColor(165, 25, 25);
    text('STORNIERT - kein gültiger Einsatznachweis', 13, true, 6);
    doc.setTextColor(0, 0, 0);
  }
  text(profile.documentSubject, 12, true, 7);
  text(salutation, 10, false, 4);
  text(cancelled ? 'Die nachfolgend aufgeführte Zuweisung wurde storniert. Dieses Dokument dient ausschließlich der Dokumentation der Stornierung.' : profile.documentIntro);

  const duration = assignments.length === 1
    ? formatProofDate(assignments[0].date)
    : `${formatProofDate(assignments[0].date)} bis ${formatProofDate(assignments.at(-1)!.date)} (${assignments.length} tatsächliche Einsatztage)`;
  const reasons: Record<string, string> = { UNPLANNED_ABSENCE: 'Ungeplanter Ausfall', MUTTERSCHUTZ: 'Geplanter Ausfall', FORTBILDUNG: 'Fortbildung' };
  const details = [
    ['Stammschule', `${teacher.stammschule.name}, ${teacher.stammschule.address}`],
    ['Zielschule', `${school.name}, ${school.address}`],
    ['Vertretung für', input.substitutedTeacher || '-'],
    ['Zeitraum', duration],
    ['Stunden gesamt', `${assignments.reduce((sum, a) => sum + a.hours, 0)} Unterrichtsstunden`],
    ['Grund', reasons[input.priority] || input.priority],
  ];
  for (const [label, value] of details) {
    doc.setFontSize(9.5);
    doc.setFont('Helvetica', 'normal');
    const lines: string[] = doc.splitTextToSize(value, 117);
    ensure(Math.min(lines.length, 4) * 4.5 + 3);
    doc.setFont('Helvetica', 'bold'); doc.text(`${label}:`, left, y);
    doc.setFont('Helvetica', 'normal');
    for (const line of lines) { ensure(4.5); doc.text(line, left + 43, y); y += 4.5; }
    y += 3;
  }
  y += 3;
  text('Tatsächlich zugewiesene Tage und Stunden', 10, true, 2);
  for (const item of assignments) text(`${formatProofDate(item.date)}: ${item.hours} Unterrichtsstunden${cancelled ? ' (storniert)' : ''}`, 9, false, 0);
  y += 6;
  const closingBlock = [[profile.documentClosing, 10], [profile.amtsleitungName, 10], [profile.amtsleitungTitle, 9]] as const;
  const closingHeight = closingBlock.reduce((sum, [value, size]) => {
    doc.setFontSize(size);
    return sum + doc.splitTextToSize(value, width).length * size * .45;
  }, 8 + (signature && !cancelled ? 21 : 8));
  doc.setFontSize(9);
  const legalHeight = BAYTGV_LEGAL_TEXT.split(/\n\n+/).reduce((sum, paragraph) => sum + doc.splitTextToSize(paragraph, width).length * 4.05 + 4, 0);
  // Avoid a page containing nothing but the closing/signature.
  if (legalHeight + closingHeight < 230) ensure(legalHeight + closingHeight);
  for (const [index, paragraph] of BAYTGV_LEGAL_TEXT.split(/\n\n+/).entries()) text(paragraph, 9, index === 0, 4);
  ensure(closingHeight);
  text(profile.documentClosing, 10, false, 2);
  if (signature && !cancelled) {
    const h = Math.min(18, 35 / signature.ratio);
    doc.addImage(signature.data, signature.format, left, y, h * signature.ratio, h); y += h + 3;
  } else y += 8;
  text(profile.amtsleitungName, 10, true, 0);
  text(profile.amtsleitungTitle, 9);
  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page); doc.setFont('Helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
    const footerName = teacher.name.replace(/\s+/g, ' ').slice(0, 60);
    doc.text(`${cancelled ? 'STORNIERT · ' : ''}${footerName} · Seite ${page} / ${count}`, left, 286);
  }
  return doc;
}
