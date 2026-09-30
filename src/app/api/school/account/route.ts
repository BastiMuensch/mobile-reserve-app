import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getSessionUser, setSessionCookie } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

const ChangeEmailSchema = z.object({
  email: z.string().trim().email('Bitte geben Sie eine gültige E-Mail-Adresse ein.').max(320).toLowerCase(),
  currentPassword: z.string().min(1, 'Bitte bestätigen Sie Ihr aktuelles Passwort.').max(200),
}).strict();

const ipLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });
const accountLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });

export async function PATCH(request: Request) {
  try {
    if (!ipLimiter.check(getClientIp(request)).success) {
      return NextResponse.json({ error: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' }, { status: 429 });
    }
    if (Number(request.headers.get('content-length') || 0) > 8 * 1024) {
      return NextResponse.json({ error: 'Ungültige Eingabe.' }, { status: 413 });
    }
    const session = await getSessionUser();
    if (!session) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
    if (session.role !== 'SCHOOL' || !session.schoolId) {
      return NextResponse.json({ error: 'Nur Schulen können ihre Schuladresse hier ändern.' }, { status: 403 });
    }
    const parsed = ChangeEmailSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    if (!accountLimiter.check(session.id).success) {
      return NextResponse.json({ error: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' }, { status: 429 });
    }
    if (!session.password.startsWith('$2') || !await bcrypt.compare(parsed.data.currentPassword, session.password)) {
      return NextResponse.json({ error: 'Das aktuelle Passwort ist nicht korrekt.' }, { status: 401 });
    }
    const { email } = parsed.data;
    if (email === session.email) {
      accountLimiter.reset(session.id);
      return NextResponse.json({ success: true, email });
    }

    const changed = await prisma.$transaction(async tx => {
      // Compare-and-swap prevents an old session from overwriting a concurrent
      // account change. Never accept an account or school ID from the request.
      const updated = await tx.user.updateMany({
        where: {
          id: session.id, role: 'SCHOOL', schoolId: session.schoolId,
          email: session.email, password: session.password,
          sessionVersion: session.sessionVersion, isActive: true, mustChangePassword: false,
        },
        data: { email, sessionVersion: { increment: 1 } },
      });
      if (updated.count !== 1) return false;
      // Links delivered to the former mailbox must no longer reset this account.
      await tx.passwordResetToken.updateMany({ where: { userId: session.id, usedAt: null }, data: { usedAt: new Date() } });
      return true;
    });
    if (!changed) {
      return NextResponse.json({ error: 'Das Konto wurde inzwischen geändert. Bitte melden Sie sich erneut an.' }, { status: 409 });
    }
    await setSessionCookie({ id: session.id, sessionVersion: session.sessionVersion + 1 });
    accountLimiter.reset(session.id);
    return NextResponse.json({ success: true, email });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Diese E-Mail-Adresse kann nicht verwendet werden. Bitte wählen Sie eine andere Adresse.' }, { status: 409 });
    }
    console.error('School email change failed.');
    return NextResponse.json({ error: 'Die E-Mail-Adresse konnte nicht geändert werden.' }, { status: 500 });
  }
}
