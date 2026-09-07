import { mkdir, unlink } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

const SAFE_IMAGE_FILENAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpe?g)$/i;
const PRIVATE_SIGNATURE_PREFIX = "/api/media/";
const PUBLIC_UPLOAD_PREFIX = "/uploads/";

/**
 * The configured value is deliberately the directory containing signature files,
 * not a parent directory. This makes accidental access to adjacent private data
 * impossible even when an operator customises the storage location.
 */
export function getPrivateSignaturesDir(): string {
  return process.env.PRIVATE_UPLOADS_DIR || path.join(process.cwd(), "private-uploads", "signatures");
}

export function getPublicUploadsDir(): string {
  return path.join(process.cwd(), "public", "uploads");
}

export function getSafeImageFilename(url: string, prefix: typeof PRIVATE_SIGNATURE_PREFIX | typeof PUBLIC_UPLOAD_PREFIX): string | null {
  if (!url.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  return SAFE_IMAGE_FILENAME.test(filename) ? filename : null;
}

export function getPrivateSignaturePath(url: string): string | null {
  const filename = getSafeImageFilename(url, PRIVATE_SIGNATURE_PREFIX);
  if (!filename) return null;
  return path.join(getPrivateSignaturesDir(), filename);
}

export function getPublicUploadPath(url: string): string | null {
  const filename = getSafeImageFilename(url, PUBLIC_UPLOAD_PREFIX);
  if (!filename) return null;
  return path.join(getPublicUploadsDir(), filename);
}

export function privateSignatureUrl(filename: string): string {
  if (!SAFE_IMAGE_FILENAME.test(filename)) throw new Error("Unsafe signature filename");
  return `${PRIVATE_SIGNATURE_PREFIX}${filename}`;
}

export function isPrivateSignatureUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && getPrivateSignaturePath(url) !== null;
}

export async function ensurePrivateSignaturesDir(): Promise<string> {
  const directory = getPrivateSignaturesDir();
  await mkdir(directory, { recursive: true });
  return directory;
}

/** Removes a file only after the database reference has been changed successfully. */
export async function removePrivateSignature(url: string | null | undefined): Promise<void> {
  if (!url || !isPrivateSignatureUrl(url)) return;
  await unlink(getPrivateSignaturePath(url)!).catch(() => undefined);
}

async function removePublicUpload(url: string): Promise<void> {
  const filePath = getPublicUploadPath(url);
  if (!filePath) return;
  await unlink(filePath).catch(() => undefined);
}

/**
 * Removes abandoned uploads after a generous grace period. New uploads remain
 * available long enough for a user to finish a profile or school edit; files
 * that are still referenced are never removed. The database row is removed
 * after the file operation so a transient filesystem error remains retryable.
 */
export async function cleanupOrphanedUploadedAssets(now = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);
  const candidates = await prisma.uploadedAsset.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, url: true, purpose: true },
    take: 200,
  });
  let removed = 0;

  for (const asset of candidates) {
    const [profileReference, schoolReference] = await Promise.all([
      prisma.schulamtProfile.count({
        where: asset.purpose === "signature"
          ? { signatureUrl: asset.url }
          : asset.purpose === "logo"
            ? { logoUrl: asset.url }
            : { OR: [{ logoUrl: asset.url }, { signatureUrl: asset.url }] },
      }),
      prisma.school.count({ where: { imageUrl: asset.url } }),
    ]);
    if (profileReference || schoolReference) continue;

    if (asset.purpose === "signature") {
      await removePrivateSignature(asset.url);
    } else {
      await removePublicUpload(asset.url);
    }
    const deletion = await prisma.uploadedAsset.deleteMany({ where: { id: asset.id } });
    removed += deletion.count;
  }

  return removed;
}
