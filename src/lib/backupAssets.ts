import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export type BackupAsset = {
  originalUrl: string;
  mimeType: string;
  sha256: string;
  dataBase64: string;
  purpose: 'logo' | 'signature' | 'school-image';
};

// 30 MiB raw data remains below the 50 MiB JSON request limit after Base64
// expansion, leaving room for the actual database export.
export const MAX_ASSET_SIZE = 5 * 1024 * 1024;
export const MAX_TOTAL_ASSETS_SIZE = 30 * 1024 * 1024;
export const MAX_BACKUP_JSON_SIZE = 50 * 1024 * 1024;

type AssetPurpose = BackupAsset['purpose'];
type AssetReferenceInput = {
  profileLogoUrl?: string | null;
  profileSignatureUrl?: string | null;
  schoolImageUrls?: (string | null | undefined)[];
};

export function getPrivateUploadsDir(): string {
  return process.env.PRIVATE_UPLOADS_DIR || path.join(process.cwd(), 'private-uploads', 'signatures');
}

export function getPublicUploadsDir(): string {
  return path.join(process.cwd(), 'public', 'uploads');
}

export function isValidMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (buf.length < 12) return false;
  switch (mimeType) {
    case 'image/jpeg': return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/png': return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case 'image/gif': return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
    case 'image/webp':
      return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
    default: return false;
  }
}

export function getMimeFromExtension(ext: string): string | null {
  switch (ext.toLowerCase()) {
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    default: return null;
  }
}

export function getExtensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    default: return '.bin';
  }
}

function filenameForUrl(url: string, prefix: '/uploads/' | '/api/media/'): string | null {
  if (!url.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) ? filename : null;
}

function diskPathForReference(url: string, purpose: AssetPurpose): string {
  const privateFilename = filenameForUrl(url, '/api/media/');
  const publicFilename = filenameForUrl(url, '/uploads/');
  if (purpose === 'signature') {
    if (privateFilename) return path.join(/* turbopackIgnore: true */ getPrivateUploadsDir(), privateFilename);
    // A v1 backup can still reference public signatures. They are imported into
    // private storage, but exporting one faithfully is necessary for recovery.
    if (publicFilename) return path.join(/* turbopackIgnore: true */ getPublicUploadsDir(), publicFilename);
  } else if (publicFilename) {
    return path.join(/* turbopackIgnore: true */ getPublicUploadsDir(), publicFilename);
  }
  throw new Error(`Ungültige ${purpose}-URL im Backup: ${url}`);
}

function expectedReferences(input: AssetReferenceInput): Map<string, AssetPurpose> {
  const expected = new Map<string, AssetPurpose>();
  const add = (url: string | null | undefined, purpose: AssetPurpose) => {
    if (!url) return;
    // Validate now, before filesystem access and before accepting an import.
    diskPathForReference(url, purpose);
    const existing = expected.get(url);
    if (existing && existing !== purpose) {
      throw new Error(`Eine Asset-URL wird mit unterschiedlichen Zwecken verwendet: ${url}`);
    }
    expected.set(url, purpose);
  };
  add(input.profileLogoUrl, 'logo');
  add(input.profileSignatureUrl, 'signature');
  for (const url of input.schoolImageUrls ?? []) add(url, 'school-image');
  return expected;
}

/**
 * A v2 backup must contain exactly one valid asset per referenced local file.
 * This prevents a successful-looking restore with a missing logo, signature or
 * school image, and stops purpose swapping during import.
 */
export function validateAssetReferences(input: AssetReferenceInput, assets: BackupAsset[]): void {
  const expected = expectedReferences(input);
  const seen = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.originalUrl)) throw new Error(`Doppeltes Asset im Backup: ${asset.originalUrl}`);
    seen.add(asset.originalUrl);
    const purpose = expected.get(asset.originalUrl);
    if (!purpose) throw new Error(`Nicht referenziertes Asset im Backup: ${asset.originalUrl}`);
    if (purpose !== asset.purpose) throw new Error(`Asset-Zweck stimmt nicht mit der Referenz überein: ${asset.originalUrl}`);
    diskPathForReference(asset.originalUrl, asset.purpose);
  }
  for (const url of expected.keys()) {
    if (!seen.has(url)) throw new Error(`Referenziertes Asset fehlt im Backup: ${url}`);
  }
}

/**
 * Version-1-Backups enthalten keine eingebetteten Dateien. Sichere Referenzen
 * auf Dateien derselben Installation bleiben kompatibel; beliebige Pfade oder
 * Traversal-Werte dürfen aber nie in Profil- oder Schuldaten gelangen.
 */
export function validateLegacyAssetReferences(input: AssetReferenceInput): void {
  expectedReferences(input);
}

function detectMime(buffer: Buffer, filename: string): string {
  const extensionMime = getMimeFromExtension(path.extname(filename));
  if (extensionMime && isValidMagicBytes(buffer, extensionMime)) return extensionMime;
  if (isValidMagicBytes(buffer, 'image/jpeg')) return 'image/jpeg';
  if (isValidMagicBytes(buffer, 'image/png')) return 'image/png';
  if (isValidMagicBytes(buffer, 'image/gif')) return 'image/gif';
  if (isValidMagicBytes(buffer, 'image/webp')) return 'image/webp';
  throw new Error(`Ungültige Bilddaten: ${filename}`);
}

/** Exports every referenced asset or fails the whole backup. */
export async function collectTenantAssets(input: AssetReferenceInput): Promise<BackupAsset[]> {
  const expected = expectedReferences(input);
  const assets: BackupAsset[] = [];
  let totalBytes = 0;
  for (const [url, purpose] of expected) {
    const filePath = diskPathForReference(url, purpose);
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      throw new Error(`Referenziertes ${purpose} konnte nicht gelesen werden: ${url}`);
    }
    if (buffer.length > MAX_ASSET_SIZE) throw new Error(`Asset überschreitet das Limit von 5 MB: ${url}`);
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_ASSETS_SIZE) {
      throw new Error('Die Gesamtgröße aller Backup-Assets überschreitet 30 MB.');
    }
    const mimeType = detectMime(buffer, filePath);
    if ((purpose === 'logo' || purpose === 'signature') && !['image/png', 'image/jpeg'].includes(mimeType)) {
      throw new Error(`Für ${purpose} sind nur PNG und JPEG erlaubt: ${url}`);
    }
    assets.push({
      originalUrl: url,
      mimeType,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      dataBase64: buffer.toString('base64'),
      purpose,
    });
  }
  return assets;
}

function decodeStrictBase64(value: string, url: string): Buffer {
  // Buffer.from silently accepts malformed Base64. Canonical validation avoids
  // checksum surprises and keeps size accounting reliable.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Ungültige Base64-Daten für Asset ${url}.`);
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.toString('base64') !== value) throw new Error(`Nicht-kanonische Base64-Daten für Asset ${url}.`);
  return buffer;
}

/**
 * Validates every asset before any file is written, then writes with new UUID
 * names. Call validateAssetReferences first to bind assets to DB references.
 */
export async function validateAndWriteImportAssets(assets: BackupAsset[]): Promise<{
  urlMapping: Map<string, string>;
  writtenFiles: string[];
}> {
  const decoded: Array<{ asset: BackupAsset; buffer: Buffer }> = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const asset of assets) {
    if (!asset.originalUrl || !asset.dataBase64 || !asset.sha256 || !asset.mimeType) {
      throw new Error(`Ungültiges Asset im Backup: Metadaten unvollständig (${asset.originalUrl}).`);
    }
    if (seen.has(asset.originalUrl)) throw new Error(`Doppeltes Asset im Backup: ${asset.originalUrl}`);
    seen.add(asset.originalUrl);
    diskPathForReference(asset.originalUrl, asset.purpose);
    if (!/^[a-fA-F0-9]{64}$/.test(asset.sha256)) throw new Error(`Ungültige SHA-256 Prüfsumme für ${asset.originalUrl}.`);

    const buffer = decodeStrictBase64(asset.dataBase64, asset.originalUrl);
    if (buffer.length > MAX_ASSET_SIZE) throw new Error(`Asset ${asset.originalUrl} überschreitet das Limit von 5 MB.`);
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_ASSETS_SIZE) throw new Error('Die Gesamtgröße aller Assets im Backup überschreitet 30 MB.');
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== asset.sha256.toLowerCase()) {
      throw new Error(`SHA-256 Prüfsummenfehler bei Asset ${asset.originalUrl}.`);
    }
    if (!isValidMagicBytes(buffer, asset.mimeType)) throw new Error(`Ungültige Bilddaten/Magic Bytes für ${asset.originalUrl}.`);
    if ((asset.purpose === 'logo' || asset.purpose === 'signature') && !['image/png', 'image/jpeg'].includes(asset.mimeType)) {
      throw new Error(`Für ${asset.purpose} sind nur PNG und JPEG erlaubt.`);
    }
    if (asset.purpose === 'school-image' && !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(asset.mimeType)) {
      throw new Error(`Unzulässiger Bildtyp für Schulbild: ${asset.mimeType}`);
    }
    decoded.push({ asset, buffer });
  }

  const privateDir = getPrivateUploadsDir();
  const publicDir = getPublicUploadsDir();
  await mkdir(privateDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  const urlMapping = new Map<string, string>();
  const writtenFiles: string[] = [];
  try {
    for (const { asset, buffer } of decoded) {
      const filename = `${uuidv4()}${getExtensionFromMime(asset.mimeType)}`;
      const destination = asset.purpose === 'signature'
        ? path.join(privateDir, filename)
        : path.join(publicDir, filename);
      await writeFile(destination, buffer, { flag: 'wx' });
      writtenFiles.push(destination);
      urlMapping.set(asset.originalUrl, asset.purpose === 'signature' ? `/api/media/${filename}` : `/uploads/${filename}`);
    }
  } catch (error) {
    await cleanupWrittenFiles(writtenFiles);
    throw error;
  }
  return { urlMapping, writtenFiles };
}

export async function cleanupWrittenFiles(files: string[]): Promise<void> {
  for (const file of files) {
    try { await unlink(file); } catch { /* best-effort rollback */ }
  }
}
