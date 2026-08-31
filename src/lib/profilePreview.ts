import { jsPDF } from "jspdf";
import fs from "fs/promises";
import { BAYTGV_LEGAL_TEXT } from "@/lib/onboarding";
import {
  getImageRatio,
  getImageRatioFromBuffer,
  getPdfImageFormat,
  getPdfImageFormatFromBuffer,
  safePublicPath,
} from "@/lib/pdfGenerator";

export type PreviewProfile = {
  headerText: string;
  returnAddress: string;
  contactAddress: string;
  contactPerson: string;
  city: string;
  amtsleitungName: string;
  amtsleitungTitle: string;
  documentSubject: string;
  documentIntro: string;
  documentClosing: string;
  logoUrl?: string | null;
  signatureUrl?: string | null;
};

type InlineImages = { logo?: Buffer | null; signature?: Buffer | null };

async function addProfileImage(
  doc: jsPDF,
  source: { url?: string | null; inline?: Buffer | null },
  x: number,
  y: number,
  width: number,
): Promise<number | null> {
  try {
    let imageData: Buffer;
    let ratio: number;
    let format: "PNG" | "JPEG";
    if (source.inline) {
      imageData = source.inline;
      ratio = getImageRatioFromBuffer(imageData);
      format = getPdfImageFormatFromBuffer(imageData);
    } else if (source.url) {
      const imagePath = safePublicPath(source.url);
      if (!imagePath) return null;
      [imageData, ratio, format] = await Promise.all([
        fs.readFile(imagePath),
        getImageRatio(imagePath),
        getPdfImageFormat(imagePath),
      ]);
    } else {
      return null;
    }
    const height = width / ratio;
    doc.addImage(`data:image/${format === "PNG" ? "png" : "jpeg"};base64,${imageData.toString("base64")}`, format, x, y, width, height);
    return height;
  } catch (error) {
    console.error("Failed to add image to profile preview:", error);
    return null;
  }
}
export async function generateProfilePreview(profile: PreviewProfile, images: InlineImages = {}): Promise<ArrayBuffer> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const formattedDate = new Date().toLocaleDateString("de-DE");

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(100, 100, 100);
  doc.text(doc.splitTextToSize(profile.headerText, 110), 25, 20);

  let sidebarY = 35;
  const logoHeight = await addProfileImage(doc, { url: profile.logoUrl, inline: images.logo }, 143, sidebarY, 42);
  if (logoHeight) sidebarY += logoHeight + 8;
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  const addressLines = doc.splitTextToSize(profile.contactAddress, 42);
  doc.text(addressLines, 143, sidebarY);
  sidebarY += addressLines.length * 3.5 + 6;
  doc.setFont("Helvetica", "bold");
  doc.text("Ihr Ansprechpartner", 143, sidebarY);
  sidebarY += 4;
  doc.setFont("Helvetica", "normal");
  doc.text(doc.splitTextToSize(profile.contactPerson, 42), 143, sidebarY);

  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(profile.returnAddress, 25, 43);
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.1);
  doc.line(25, 44, 110, 44);
  doc.setTextColor(0, 0, 0);

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Frau/Herrn", 25, 52);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Beispiel-Lehrkraft", 25, 58);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Beispieladresse", 25, 64);
  doc.text("PLZ Ort", 25, 69);
  doc.text(`${profile.city}, den ${formattedDate}`, 25, 82);

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(12);
  const subjectY = 110;
  const subjectLines = doc.splitTextToSize(profile.documentSubject, 160);
  doc.text(subjectLines, 25, subjectY);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(10);
  const salutationY = subjectY + subjectLines.length * 5 + 10;
  doc.text("Guten Tag,", 25, salutationY);
  const introY = salutationY + 8;
  const introLines = doc.splitTextToSize(profile.documentIntro, 160);
  doc.text(introLines, 25, introY);

  let currentY = introY + introLines.length * 5 + 10;
  const details = [
    ["Von (Stammschule):", "Beispiel-Stammschule, Beispielweg 1"],
    ["An (Schule):", "Beispiel-Zielschule, Zielweg 2"],
    ["Name der zu vertretenden Lehrkraft:", "Beispiel-Lehrkraft"],
    ["Dauer der Vertretung:", formattedDate],
    ["Stundenzahl:", "5 Std. (ab 1. Std)"],
    ["Grund für die Vertretung:", "Ungeplanter Ausfall"],
  ];
  for (const [label, value] of details) {
    doc.setFont("Helvetica", "bold");
    doc.text(label, 25, currentY);
    doc.setFont("Helvetica", "normal");
    const valueLines = doc.splitTextToSize(value, 95);
    doc.text(valueLines, 90, currentY);
    currentY += valueLines.length * 5 + 3;
  }

  doc.setFontSize(9);
  const legalParagraphs = BAYTGV_LEGAL_TEXT.split(/\n\n+/);
  let legalY = currentY + 5;
  for (const [index, paragraph] of legalParagraphs.entries()) {
    doc.setFont("Helvetica", index === 0 ? "bold" : "normal");
    const lines = doc.splitTextToSize(paragraph, 160);
    doc.text(lines, 25, legalY);
    legalY += lines.length * 4.5 + 4;
  }

  const signatureY = legalY + 8;
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(10);
  doc.text(profile.documentClosing, 25, signatureY);
  const signatureHeight = await addProfileImage(doc, { url: profile.signatureUrl, inline: images.signature }, 25, signatureY + 3, 35);
  const signatureOffset = signatureHeight ? signatureHeight + 6 : 16;
  doc.setFont("Helvetica", "bold");
  doc.text(profile.amtsleitungName, 25, signatureY + signatureOffset);
  doc.setFont("Helvetica", "normal");
  doc.text(profile.amtsleitungTitle, 25, signatureY + signatureOffset + 5);

  return doc.output("arraybuffer");
}
