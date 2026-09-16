import { timingSafeEqual } from 'node:crypto';

export function matchesRecoverySecret(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected || expected.length < 32) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readRecoveryJson(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error('Body too large'); }
      chunks.push(next.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
    return value;
  } finally { reader.releaseLock(); }
}
