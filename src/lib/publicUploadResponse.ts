import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp)$/i;

function contentType(filename: string) {
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.gif$/i.test(filename)) return 'image/gif';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  return 'image/jpeg';
}

/** Read uploads at request time, including files added after the server started. */
export async function publicUploadResponse(filename: string) {
  const root = process.env.PUBLIC_UPLOADS_DIR || path.join(process.cwd(), 'public', 'uploads');
  if (!path.isAbsolute(root) || !SAFE_FILENAME.test(filename)) return new NextResponse(null, { status: 404 });
  let handle;
  try {
    handle = await open(path.join(root, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > MAX_IMAGE_BYTES) throw new Error('Invalid media');
    const stream = handle.createReadStream({ autoClose: true });
    handle = undefined;
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, { headers: {
      'Cache-Control': 'no-store', 'Content-Type': contentType(filename), 'Content-Length': String(info.size), 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return new NextResponse(null, { status: 404 }); }
  finally { await handle?.close(); }
}
