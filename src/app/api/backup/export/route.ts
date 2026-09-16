import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { createEncryptedInstanceBackup } from '@/lib/fullBackup';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
const schema = z.object({ password: z.string().min(1).max(200), backupPassword: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict();
const response = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== 'SCHULAMT') return response('Nicht berechtigt.', 403);
  return response('Bitte nutzen Sie den verschlüsselten Vollbackup-Dialog in der Anwendung.', 405);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== 'SCHULAMT') return response('Nicht berechtigt.', 403);
  const expectedOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
  if (request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return response('Ungültige Anfragequelle.', 403);
  if (!limiter.check(`user:${user.id}`).success || !limiter.check(`ip:${getClientIp(request)}`).success) return response('Zu viele Versuche. Bitte warten Sie 15 Minuten.', 429);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return response('Ungültiges Format.', 400);
  const reader = request.body?.getReader();
  if (!reader) return response('Ungültige Anfrage.', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); return response('Anfrage zu groß.', 413); }
      chunks.push(part.value);
    }
    const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) return response('Ungültige Eingaben.', 400);
    if (!user.password.startsWith('$2') || !await bcrypt.compare(parsed.data.password, user.password)) return response('Das aktuelle Passwort ist nicht korrekt.', 401);
    const archive = await createEncryptedInstanceBackup(parsed.data.backupPassword);
    const currentUser = await getSessionUser();
    if (!currentUser || currentUser.id !== user.id || currentUser.role !== 'SCHULAMT') return response('Sitzung nicht mehr gültig.', 403);
    await prisma.schulamtProfile.updateMany({ where: { userId: user.id }, data: { lastBackupDate: new Date() } });
    return new NextResponse(new Uint8Array(archive), { headers: { ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="mobile-reserve-vollbackup_${new Date().toISOString().replace(/[:.]/g, '-')}.mrbackup"`,
    } });
  } catch (error) {
    if (error instanceof SyntaxError) return response('Ungültige Anfrage.', 400);
    // No exception objects: subprocess failures can contain credentials.
    console.error('[full-backup] Export konnte nicht abgeschlossen werden.');
    if (error instanceof Error && error.message === 'BACKUP_BUSY') return response('Es wird bereits ein Backup erstellt. Bitte warten.', 409);
    return response('Vollbackup fehlgeschlagen. Bitte erneut versuchen. Bei wiederholtem Fehler muss die Serverkonfiguration geprüft werden (pg_dump, Schlüssel, Upload-Dateien und Größenlimit). Es wurde keine unvollständige Sicherung ausgegeben.', 500);
  } finally { reader.releaseLock(); }
}
