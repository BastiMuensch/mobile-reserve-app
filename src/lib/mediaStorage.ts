import { mkdir, unlink } from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const SAFE_SIGNATURE_FILENAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpe?g)$/i;
const SAFE_PUBLIC_IMAGE_FILENAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpe?g|gif|webp)$/i;
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
  return process.env.PUBLIC_UPLOADS_DIR || path.join(process.cwd(), "public", "uploads");
}

export function getSafeImageFilename(url: string, prefix: typeof PRIVATE_SIGNATURE_PREFIX | typeof PUBLIC_UPLOAD_PREFIX): string | null {
  if (!url.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  const pattern = prefix === PRIVATE_SIGNATURE_PREFIX ? SAFE_SIGNATURE_FILENAME : SAFE_PUBLIC_IMAGE_FILENAME;
  return pattern.test(filename) ? filename : null;
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
  if (!SAFE_SIGNATURE_FILENAME.test(filename)) throw new Error("Unsafe signature filename");
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
export async function removePrivateSignature(url: string | null | undefined): Promise<boolean> {
  if (!url || !isPrivateSignatureUrl(url)) return false;
  try {
    await unlink(getPrivateSignaturePath(url)!);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/**
 * Keep the deletion work durable when the asset owner's account is removed.
 * Call inside the same transaction, before deleting the users. The row locks
 * keep concurrent uploads out of the transfer/deletion window, so their
 * metadata cannot disappear through the account's cascading delete.
 */
export async function retainAssetsBeforeAccountDeletion(
  tx: Prisma.TransactionClient,
  userIds: string[],
  schulamtId: string,
): Promise<string[]> {
  const owners = [...new Set(userIds)].filter(id => id !== schulamtId);
  if (owners.length === 0) return [];
  await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${Prisma.join(owners)}) ORDER BY id FOR UPDATE`;
  const assets = await tx.uploadedAsset.findMany({
    where: { ownerUserId: { in: owners } }, select: { id: true },
  });
  const ids = assets.map(asset => asset.id);
  if (ids.length) await tx.uploadedAsset.updateMany({
    where: { id: { in: ids } }, data: { ownerUserId: schulamtId },
  });
  return ids;
}

async function cleanupUploadedAssetsWhere(where: Prisma.UploadedAssetWhereInput): Promise<number> {
  let removed = 0;
  let afterId: string | undefined;
  // Scan every page, including when the first 200 old uploads are all in use.
  // A deleted row cannot serve as a Prisma cursor, so continue by ordered ID.
  while (true) {
    const candidates = await prisma.uploadedAsset.findMany({
      where: { AND: [where, ...(afterId ? [{ id: { gt: afterId } }] : [])] },
      select: { id: true, url: true, purpose: true },
      orderBy: { id: "asc" },
      take: 200,
    });
    if (candidates.length === 0) break;
    afterId = candidates[candidates.length - 1].id;

    for (const asset of candidates) {
      const [profileReference, schoolReference, locationReference, loginLogoReference] = await Promise.all([
        prisma.schulamtProfile.count({
          where: { OR: [{ logoUrl: asset.url }, { signatureUrl: asset.url }] },
        }),
        prisma.school.count({ where: { imageUrl: asset.url } }),
        prisma.schoolLocation.count({ where: { imageUrl: asset.url } }),
        prisma.systemSetting.count({ where: { id: "loginLogoUrl", value: asset.url } }),
      ]);
      if (profileReference || schoolReference || locationReference || loginLogoReference) continue;

      const filePath = asset.purpose === "signature"
        ? getPrivateSignaturePath(asset.url)
        : getPublicUploadPath(asset.url);
      if (!filePath) throw new Error("Ungültiger Pfad eines verwaisten Uploads.");
      try {
        await unlink(filePath);
      } catch (error) {
        // Missing files already satisfy deletion. Other failures must retain the
        // metadata and fail the run, otherwise the file could never be retried.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const deletion = await prisma.uploadedAsset.deleteMany({ where: { id: asset.id } });
      removed += deletion.count;
    }
  }

  return removed;
}

/**
 * Run after a successful school deletion or import. Referenced files survive;
 * failures retain their metadata so the scheduled cleanup can retry them.
 */
export async function cleanupUploadedAssets(assetIds: string[]): Promise<number> {
  if (assetIds.length === 0) return 0;
  return cleanupUploadedAssetsWhere({ id: { in: [...new Set(assetIds)] } });
}

/** Give unfinished profile edits seven days before considering their uploads abandoned. */
export async function cleanupOrphanedUploadedAssets(now = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);
  return cleanupUploadedAssetsWhere({ createdAt: { lt: cutoff } });
}
