import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { schoolYearSchema } from '@/lib/schoolYear';
import { loadSchoolYearArchiveData, buildSchoolYearArchiveFiles, SchoolYearArchiveLimitError } from '@/lib/schoolYearArchiveData';
import { encryptSchoolYearArchive, type SchoolYearArchiveFile } from '@/lib/schoolYearArchiveZip';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
const schema = z.object({
  year: schoolYearSchema.refine(value => Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) < 2100),
  password: z.string().min(1).max(200),
  archivePassword: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
}).strict();
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
// This application runs one server process per instance. Bound CPU/memory from
// concurrent exports. No lock is kept after a failure or a disconnected request.
let busy = false;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return fail('Nicht angemeldet.', 401);
  if (user.role !== 'SCHULAMT') return fail('Kein Zugriff.', 403);
  return fail('Bitte verwenden Sie den Schuljahresarchiv-Dialog.', 405);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail('Nicht angemeldet.', 401);
  if (user.role !== 'SCHULAMT') return fail('Kein Zugriff.', 403);
  let expectedOrigin: string;
  try { expectedOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin; }
  catch { return fail('Die öffentliche App-Adresse ist ungültig konfiguriert.', 503); }
  if (request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return fail('Ungültige Anfragequelle.', 403);
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return fail('Ungültiges Format.', 400);
  if (!limiter.check(`user:${user.id}`).success || !limiter.check(`ip:${getClientIp(request)}`).success) return fail('Zu viele Versuche. Bitte warten Sie 15 Minuten.', 429);
  const reader = request.body?.getReader();
  if (!reader) return fail('Ungültige Anfrage.', 400);
  let ownsLock = false;
  let files: SchoolYearArchiveFile[] = [];
  const chunks: Uint8Array[] = [];
  try {
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); return fail('Anfrage zu groß.', 413); }
      chunks.push(part.value);
    }
    const input = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!input.success) return fail('Ungültige Eingaben oder ungültiges Schuljahr.', 400);
    if (!user.password.startsWith('$2') || !await bcrypt.compare(input.data.password, user.password)) return fail('Das aktuelle Passwort ist nicht korrekt.', 401);
    input.data.password = '';
    if (busy) return fail('Es wird bereits ein Schuljahresarchiv erstellt. Bitte warten.', 409);
    busy = true; ownsLock = true;
    request.signal.throwIfAborted();
    const data = await loadSchoolYearArchiveData(user.id, input.data.year);
    request.signal.throwIfAborted();
    const result = await buildSchoolYearArchiveFiles(data);
    files = result.files;
    request.signal.throwIfAborted();
    const archive = await encryptSchoolYearArchive(files, input.data.archivePassword, request.signal);
    input.data.archivePassword = '';
    const currentUser = await getSessionUser();
    if (!currentUser || currentUser.id !== user.id || currentUser.role !== 'SCHULAMT' || currentUser.password !== user.password) {
      archive.fill(0);
      return fail('Sitzung nicht mehr gültig. Bitte erneut anmelden.', 403);
    }
    // Keep proxy/browser response headers small even when many historical
    // anomalies exist. The complete warnings remain in the encrypted report.
    const summaryForHeader = { ...result.summary, warnings: [...result.summary.warnings] };
    let summary = Buffer.from(JSON.stringify(summaryForHeader)).toString('base64url');
    let omitted = 0;
    while ((summary.length > 3300 || summaryForHeader.warnings.length > 24) && summaryForHeader.warnings.length) {
      summaryForHeader.warnings.pop(); omitted++;
      summary = Buffer.from(JSON.stringify(summaryForHeader)).toString('base64url');
    }
    if (omitted) {
      summaryForHeader.warnings.push(`${omitted} weitere Hinweise stehen im Inhaltsverzeichnis und Prüfbericht des Archivs.`);
      summary = Buffer.from(JSON.stringify(summaryForHeader)).toString('base64url');
    }
    return new NextResponse(new Uint8Array(archive), { headers: {
      ...headers, 'Content-Type': 'application/zip', 'X-Archive-Summary': summary,
      'Content-Disposition': `attachment; filename="Schuljahresarchiv_${input.data.year.replace('/', '-')}_${new Date().toISOString().slice(0, 10)}.zip"`,
    } });
  } catch (error) {
    if (error instanceof SyntaxError) return fail('Ungültige Anfrage.', 400);
    if (request.signal.aborted) return fail('Archivexport abgebrochen.', 499);
    // Never emit exception objects: database errors can include personal data.
    console.error('[school-year-archive] Erstellung fehlgeschlagen; kein Archiv ausgegeben.');
    if (error instanceof SchoolYearArchiveLimitError || error instanceof Error && error.message === 'ARCHIVE_LIMIT') return fail('Der Datenumfang überschreitet die sichere Exportgrenze. Bitte wenden Sie sich an die technische Betreuung. Es wurde kein unvollständiges Archiv ausgegeben.', 413);
    return fail('Das Archiv konnte nicht vollständig erstellt werden. Bitte Schulamtsprofil, Briefkopf, Bilddateien und gespeicherte Monatsmeldungen prüfen und erneut versuchen. Es wurde kein unvollständiges Archiv ausgegeben.', 500);
  } finally {
    reader.releaseLock();
    for (const chunk of chunks) chunk.fill(0);
    for (const file of files) file.data.fill(0);
    if (ownsLock) busy = false;
  }
}
