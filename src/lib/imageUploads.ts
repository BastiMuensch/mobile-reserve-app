import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { ensurePrivateSignaturesDir, getPublicUploadsDir, privateSignatureUrl } from "@/lib/mediaStorage";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
]);

function hasValidMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  return false;
}
/**
 * Persists a setup image. Logos are public document branding; hand-written
 * signatures are personal data and must never be placed under Next's public/
 * directory.
 */
export async function persistOnboardingImage(
  file: File | null,
  visibility: "public" | "private-signature" = "public",
): Promise<{ url: string; path: string } | null> {
  if (!file || file.size === 0) return null;
  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  if (!extension) throw new Error("Nur PNG- und JPEG-Dateien sind für Logo und Unterschrift erlaubt.");
  if (file.size > MAX_IMAGE_SIZE) throw new Error("Logo und Unterschrift dürfen jeweils höchstens 5 MB groß sein.");

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!hasValidMagicBytes(buffer, file.type)) throw new Error("Die hochgeladene Bilddatei ist beschädigt oder falsch deklariert.");

  const filename = `${randomUUID()}${extension}`;
  const uploadDirectory = visibility === "private-signature"
    ? await ensurePrivateSignaturesDir()
    : getPublicUploadsDir();
  const filePath = path.join(uploadDirectory, filename);
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(filePath, buffer, { flag: "wx" });
  return {
    url: visibility === "private-signature" ? privateSignatureUrl(filename) : `/uploads/${filename}`,
    path: filePath,
  };
}

export async function removePersistedImages(files: Array<{ path: string } | null>): Promise<void> {
  await Promise.all(files.filter((file): file is { path: string } => Boolean(file)).map((file) => unlink(file.path).catch(() => undefined)));
}
