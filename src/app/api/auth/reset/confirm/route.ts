import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

// IP-based rate limiter to slow down token-guessing attempts
const ipLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 20 });

const ConfirmSchema = z.object({
  token: z.string().min(1, 'Token ist erforderlich'),
  password: z.string().min(12, 'Passwort muss mindestens 12 Zeichen lang sein').max(200)
    .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Passwort darf höchstens 72 UTF-8-Bytes lang sein.'),
});

const INVALID_TOKEN_ERROR = 'Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen Link an.';
class InvalidResetTokenError extends Error {}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const { success: ipAllowed } = ipLimiter.check(ip);
    if (!ipAllowed) {
      return NextResponse.json(
        { error: 'Zu viele Versuche. Bitte warten Sie eine Stunde.' },
        { status: 429 }
      );
    }

    const data = await request.json();
    const parsedData = ConfirmSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const { token, password } = parsedData.data;

    const tokenHash = hashToken(token);
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { password: true, sessionVersion: true } } },
    });

    if (!resetToken || resetToken.usedAt !== null || resetToken.expiresAt <= new Date()) {
      return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.$transaction(async tx => {
      const account = await tx.user.findUnique({
        where: { id: resetToken.userId },
        select: { role: true, teachers: { select: { status: true } } },
      });
      if (!account) throw new InvalidResetTokenError();
      const mayActivate = account.role !== 'TEACHER' || account.teachers.every(teacher => teacher.status !== 'PENDING');
      // Every credential writer locks the account before its reset tokens.
      // Claiming a token first can deadlock against a concurrent password change
      // that already holds the account and is invalidating those same tokens.
      const updated = await tx.user.updateMany({
        where: { id: resetToken.userId, password: resetToken.user.password, sessionVersion: resetToken.user.sessionVersion },
        data: { password: hashedPassword, isActive: mayActivate, mustChangePassword: false, sessionVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new InvalidResetTokenError();
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      // Throw, rather than return false: an expired/revoked token must roll back
      // the account update above, including activation and session version.
      if (claimed.count !== 1) throw new InvalidResetTokenError();
      // One successful reset invalidates every outstanding link for this
      // account, including links issued before the one just consumed.
      await tx.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
    });

    return NextResponse.json({ success: true, message: 'Ihr Passwort wurde erfolgreich geändert.' });
  } catch (error) {
    if (error instanceof InvalidResetTokenError) {
      return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 });
    }
    console.error('Password reset confirmation failed.');
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten' }, { status: 500 });
  }
}
