import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { matchesRecoverySecret } from '@/lib/recoveryAccess';

export const runtime = 'nodejs';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/i;

function contentType(filename: string) {
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  return 'image/jpeg';
}

function publicUploadsRoot(env: Record<string, string | undefined> = process.env, cwd = process.cwd()) {
  return env.PUBLIC_UPLOADS_DIR || path.join(cwd, 'public', 'uploads');
}

export async function GET(request: Request, { params }: { params: Promise<{ filename: string }> }) {
  if (!matchesRecoverySecret(request.headers.get('x-recovery-auth-token'), process.env.RECOVERY_AUTH_TOKEN)) return new NextResponse(null, { status: 403 });
  const { filename } = await params;
  const root = publicUploadsRoot();
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
