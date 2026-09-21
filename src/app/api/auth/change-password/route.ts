import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getSessionUser, signToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

const MAX_BCRYPT_BYTES = 72;
const passwordSchema = z.string().min(12, 'Das neue Passwort muss mindestens 12 Zeichen lang sein.').max(200)
  .refine(value => Buffer.byteLength(value, 'utf8') <= MAX_BCRYPT_BYTES, 'Das neue Passwort darf höchstens 72 UTF-8-Bytes lang sein.');
const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
}).strict();

// Verifying the existing secret is intentionally throttled independently from
// login. The map is process-local, matching the other auth rate limits.
const ipLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });
const accountLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!ipLimiter.check(ip).success) {
      return NextResponse.json({ error: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' }, { status: 429 });
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 8 * 1024) return NextResponse.json({ error: 'Ungültige Eingabe.' }, { status: 413 });

    // This is the sole endpoint that intentionally accepts a session whose
    // temporary password still has to be changed.
    const session = await getSessionUser({ allowPasswordChangeRequired: true });
    if (!session || session.role !== 'SCHOOL') {
      return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
    }
    if (!accountLimiter.check(session.id).success) {
      return NextResponse.json({ error: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' }, { status: 429 });
    }

    const parsed = ChangePasswordSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { currentPassword, newPassword } = parsed.data;
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: 'Das neue Passwort muss sich vom bisherigen Passwort unterscheiden.' }, { status: 400 });
    }
    if (!session.password.startsWith('$2') || !await bcrypt.compare(currentPassword, session.password)) {
      return NextResponse.json({ error: 'Das aktuelle Passwort ist nicht korrekt.' }, { status: 401 });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    const changed = await prisma.$transaction(async tx => {
      // The previous hash and session version make this a compare-and-swap:
      // a concurrent reset or password change wins exactly once.
      const updated = await tx.user.updateMany({
        where: { id: session.id, password: session.password, sessionVersion: session.sessionVersion },
        data: { password: newHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      await tx.passwordResetToken.updateMany({
        where: { userId: session.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return session.sessionVersion + 1;
    });
    if (changed === null) {
      return NextResponse.json({ error: 'Das Konto wurde in der Zwischenzeit geändert. Bitte melden Sie sich erneut an.' }, { status: 409 });
    }

    accountLimiter.reset(session.id);
    const token = await signToken({ id: session.id, sessionVersion: changed });
    const cookieStore = await cookies();
    cookieStore.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return NextResponse.json({ success: true, mustChangePassword: false });
  } catch {
    console.error('Password change failed.');
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten.' }, { status: 500 });
  }
}
