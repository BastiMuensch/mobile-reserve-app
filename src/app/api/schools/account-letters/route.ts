import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { createSchoolAccountLetters } from '@/lib/schoolAccountLetters';

export const dynamic = 'force-dynamic';

const MAX_SCHOOLS_PER_EXPORT = 100;
const SelectedSchoolsSchema = z.object({
  schoolIds: z.array(z.string().uuid()).min(1, 'Wählen Sie mindestens eine Schule aus.').max(MAX_SCHOOLS_PER_EXPORT, `Es können höchstens ${MAX_SCHOOLS_PER_EXPORT} Schulen gleichzeitig als Zugangsbriefe erstellt werden.`),
  confirmPasswordReset: z.literal(true),
}).strict().superRefine((value, context) => {
  if (new Set(value.schoolIds).size !== value.schoolIds.length) {
    context.addIssue({ code: 'custom', path: ['schoolIds'], message: 'Jede Schule darf nur einmal ausgewählt werden.' });
  }
});
const AllSchoolsSchema = z.object({
  allSchools: z.literal(true),
  confirmPasswordReset: z.literal(true),
}).strict();
const RequestSchema = z.union([SelectedSchoolsSchema, AllSchoolsSchema]);

class ConcurrentAccountChangeError extends Error {}

function createInitialPassword(): string {
  // Excludes visually confusing characters while retaining enough entropy for a
  // printed one-time credential. Each character is independently random.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!$%*+-';
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function resolveLoginUrl(request: Request): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  // A browser supplied Origin header is not a trustworthy URL source. In local
  // development Request.url is constructed by the local Next server instead.
  const candidate = configured || (process.env.NODE_ENV !== 'production' ? new URL(request.url).origin : null);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) return null;
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return null;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (session.role !== 'SCHULAMT') return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 });

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Ungültige Anfrage.' }, { status: 400 });
  const loginUrl = resolveLoginUrl(request);
  if (!loginUrl) return NextResponse.json({ error: 'Die sichere Portal-URL ist nicht konfiguriert.' }, { status: 500 });

  try {
    const requestedSchoolIds = 'schoolIds' in parsed.data ? parsed.data.schoolIds : null;
    const schools = await prisma.school.findMany({
      where: requestedSchoolIds
        ? { id: { in: requestedSchoolIds }, schulamtId: session.id }
        : { schulamtId: session.id, user: { is: { role: 'SCHOOL' } } },
      select: {
        id: true,
        name: true,
        user: { select: { id: true, email: true, password: true, role: true, sessionVersion: true, schoolId: true } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    if (!schools.length) {
      return NextResponse.json({ error: 'Für die Auswahl gibt es keine Schule mit einem Schulzugang.' }, { status: 400 });
    }
    if (requestedSchoolIds && (schools.length !== requestedSchoolIds.length || schools.some(school => !school.user || school.user.role !== 'SCHOOL'))) {
      return NextResponse.json({ error: 'Mindestens eine Schule gehört nicht zu Ihrem Schulamt oder hat keinen Schulzugang.' }, { status: 404 });
    }
    const accounts = schools.map(school => ({ schoolId: school.id, schoolName: school.name, user: school.user!, password: createInitialPassword() }));
    // Create the whole document before changing any account. Its only copy of
    // the credentials is the outgoing response buffer.
    const pdf = await createSchoolAccountLetters({
      appUrl: loginUrl,
      accounts: accounts.map(account => ({ schoolName: account.schoolName, email: account.user.email, initialPassword: account.password })),
    });
    const passwordHashes = await Promise.all(accounts.map(account => bcrypt.hash(account.password, 12)));

    await prisma.$transaction(async tx => {
      const current = await tx.school.findMany({
        where: { id: { in: accounts.map(account => account.schoolId) }, schulamtId: session.id },
        select: { id: true, user: { select: { id: true, email: true, password: true, role: true, sessionVersion: true, schoolId: true } } },
      });
      if (current.length !== accounts.length) throw new ConcurrentAccountChangeError();
      const currentById = new Map(current.map(school => [school.id, school]));
      for (const account of accounts) {
        const now = currentById.get(account.schoolId)?.user;
        if (!now || now.id !== account.user.id || now.email !== account.user.email || now.password !== account.user.password || now.role !== 'SCHOOL' || now.sessionVersion !== account.user.sessionVersion || now.schoolId !== account.schoolId) {
          throw new ConcurrentAccountChangeError();
        }
      }
      for (const [index, account] of accounts.entries()) {
        const changed = await tx.user.updateMany({
          where: { id: account.user.id, email: account.user.email, password: account.user.password, role: 'SCHOOL', schoolId: account.schoolId, sessionVersion: account.user.sessionVersion },
          data: { password: passwordHashes[index], isActive: true, mustChangePassword: true, sessionVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ConcurrentAccountChangeError();
        await tx.passwordResetToken.updateMany({ where: { userId: account.user.id, usedAt: null }, data: { usedAt: new Date() } });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });

    // Copy into a plain ArrayBuffer: the DOM BodyInit type deliberately does
    // not accept TypedArrays whose backing buffer could be SharedArrayBuffer.
    const responsePdf = new Uint8Array(pdf);
    return new NextResponse(responsePdf.buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Schulzugangsbriefe.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Account-Letter-Count': String(accounts.length),
      },
    });
  } catch (error) {
    if (error instanceof ConcurrentAccountChangeError || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) {
      return NextResponse.json({ error: 'Ein Schulkonto wurde parallel geändert. Bitte laden Sie die Schulen neu und erstellen Sie die Briefe erneut.' }, { status: 409 });
    }
    console.error('School account letter export failed.');
    return NextResponse.json({ error: 'Die Zugangsbriefe konnten nicht erstellt werden.' }, { status: 500 });
  }
}
