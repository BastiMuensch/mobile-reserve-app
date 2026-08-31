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
  password: z.string().min(12, 'Passwort muss mindestens 12 Zeichen lang sein').max(200),
});

const INVALID_TOKEN_ERROR = 'Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen Link an.';

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
    });

    if (!resetToken || resetToken.usedAt !== null || resetToken.expiresAt <= new Date()) {
      return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const changed = await prisma.$transaction(async tx => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) return false;

      const account = await tx.user.findUnique({
        where: { id: resetToken.userId },
        select: { role: true, teachers: { select: { status: true } } },
      });
      if (!account) return false;
      const mayActivate = account.role !== 'TEACHER' || account.teachers.every(teacher => teacher.status !== 'PENDING');
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword, isActive: mayActivate, sessionVersion: { increment: 1 } },
      });
      return true;
    });
    if (!changed) {
      return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Ihr Passwort wurde erfolgreich geändert.' });
  } catch (error) {
    console.error('Password reset confirm error:', error);
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten' }, { status: 500 });
  }
}
