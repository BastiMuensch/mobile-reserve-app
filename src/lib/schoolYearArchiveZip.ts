import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';

// ZIP generation holds plaintext + two ZIP buffers temporarily; this is a raw
// content cap, not a claim that peak heap equals this number.
export const ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;
export const ARCHIVE_MAX_FILES = 5000;
export interface SchoolYearArchiveFile { path: string; data: Uint8Array }

/** ZIP exposes its directory even with AES encryption. Encrypt a neutral inner
 * ZIP entry so personal filenames never appear in the outer directory. Both
 * layers use standard ZIP, not the application's recovery-backup format. */
export async function encryptSchoolYearArchive(files: SchoolYearArchiveFile[], password: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(password)) throw new Error('ARCHIVE_PASSWORD');
  if (!files.length || files.length > ARCHIVE_MAX_FILES) throw new Error('ARCHIVE_LIMIT');
  let size = 0;
  const paths = new Set<string>();
  for (const file of files) {
    if (!file.path || file.path.length > 240 || /[\x00-\x1f\x7f\\:<>"|?*]/.test(file.path)
      || file.path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw new Error('ARCHIVE_PATH');
    const path = file.path.normalize('NFC').toLowerCase();
    if (paths.has(path)) throw new Error('ARCHIVE_PATH');
    paths.add(path);
    size += file.data.byteLength;
    if (size > ARCHIVE_MAX_BYTES) throw new Error('ARCHIVE_LIMIT');
  }
  for (const path of paths) {
    const parts = path.split('/');
    for (let n = 1; n < parts.length; n++) if (paths.has(parts.slice(0, n).join('/'))) throw new Error('ARCHIVE_PATH');
  }
  signal?.throwIfAborted();
  // Store rather than recompress PDFs/XLSX. Bounded buffers avoid unencrypted
  // temporary files and keep memory use predictable in the single-process app.
  const inner = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, level: 0, zip64: false });
  let innerBytes: Uint8Array | undefined;
  try {
    for (const file of files) {
      signal?.throwIfAborted();
      await inner.add(file.path, new Uint8ArrayReader(file.data), { signal });
    }
    innerBytes = await inner.close();
    if (innerBytes.byteLength > ARCHIVE_MAX_BYTES + 4 * 1024 * 1024) throw new Error('ARCHIVE_LIMIT');
    const outer = new ZipWriter(new Uint8ArrayWriter(), {
      useWebWorkers: false, level: 0, zip64: false, password, encryptionStrength: 3, zipCrypto: false,
    });
    await outer.add('Archivinhalt.zip', new Uint8ArrayReader(innerBytes), { signal });
    return await outer.close();
  } finally {
    innerBytes?.fill(0);
  }
}
