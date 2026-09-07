import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { sendEmail } from '@/lib/email';
import crypto from 'crypto';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { mayIssueAnotherResetToken } from '@/lib/resetTokens';
import { isWebRole } from '@/lib/webRoles';
import { z } from 'zod';

const ResetRequestSchema = z.object({
  email: z.string().trim().email().max(320),
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Per-email rate limiter
const emailLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 3 });

// IP-based rate limiter (broader limit per IP)
const ipLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 10 });

const GENERIC_SUCCESS = {
  success: true,
  message: 'Falls ein Konto mit dieser E-Mail existiert, wurde eine E-Mail gesendet.'
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueResetToken(userId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const outstanding = await tx.passwordResetToken.count({
          where: { userId, usedAt: null, expiresAt: { gt: now } },
        });
        if (!mayIssueAnotherResetToken(outstanding)) return null;

        const token = crypto.randomBytes(32).toString('base64url');
        await tx.passwordResetToken.create({
          data: {
            tokenHash: hashToken(token),
            userId,
            expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
          },
        });
        return token;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
      console.error('Password reset token could not be issued:', error);
      return null;
    }
  }
  return null;
}

/**
 * Basis-URL für den Reset-Link.
 *
 * SICHERHEIT: origin/host stammen aus vom Client kontrollierten Headern. Würden wir
 * den Link daraus bauen, könnte ein Angreifer per gefälschtem Host-Header einen Reset
 * für ein fremdes Konto anfordern; der Link in der (echten) E-Mail des Opfers zeigte
 * dann auf seinen Server und der Token wäre beim Klick kompromittiert
 * ("Password Reset Poisoning"). Deshalb ist NEXT_PUBLIC_APP_URL die einzige Quelle;
 * die Header dienen nur noch als Notnagel für lokale Entwicklung.
 */
function resolveAppBaseUrl(request: Request): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV !== 'production') {
    const origin = request.headers.get('origin');
    if (origin) return origin.replace(/\/$/, '');
    const host = request.headers.get('host');
    if (host) return `http://${host}`;
  }

  console.error(
    'NEXT_PUBLIC_APP_URL ist nicht gesetzt – es kann kein Passwort-Reset-Link erzeugt werden. ' +
    'Bitte in der .env setzen (siehe DEPLOYMENT.md).'
  );
  return null;
}

export async function POST(request: Request) {
  try {
    // IP-based rate limiting
    const ip = getClientIp(request);
    const { success: ipAllowed } = ipLimiter.check(ip);
    if (!ipAllowed) {
      return NextResponse.json(GENERIC_SUCCESS);
    }

    const parsed = ResetRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' }, { status: 400 });
    }
    const normalizedEmail = parsed.data.email.toLowerCase();

    // Per-email rate limit check
    const { success: emailAllowed } = emailLimiter.check(normalizedEmail);
    if (!emailAllowed) {
      return NextResponse.json(GENERIC_SUCCESS);
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        school: true,
        teachers: {
          include: {
            stammschule: true
          }
        }
      }
    });

    if (!user || !isWebRole(user.role)) {
      // Return success anyway to prevent email enumeration
      return NextResponse.json(GENERIC_SUCCESS);
    }

    // Basis-URL zuerst auflösen: ohne sie wäre der versendete Link unbrauchbar,
    // dann lieber gar keinen Token anlegen.
    const baseUrl = resolveAppBaseUrl(request);
    if (!baseUrl) {
      return NextResponse.json(GENERIC_SUCCESS);
    }

    // Existing, unexpired links remain usable until a password is successfully
    // changed. A small serializable cap prevents unlimited outstanding tokens.
    const token = await issueResetToken(user.id);
    if (!token) return NextResponse.json(GENERIC_SUCCESS);

    const resetLink = `${baseUrl}/reset?token=${token}`;

    const emailBody = `Hallo,\n\nfür Ihr Konto im Mobile Reserven Portal wurde ein Zurücksetzen des Passworts angefordert.\n\nKlicken Sie auf folgenden Link, um ein neues Passwort zu vergeben (gültig für 1 Stunde):\n\n${resetLink}\n\nWenn Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.`;

    let schulamtId: string | undefined;
    if (user.role === 'SCHULAMT') schulamtId = user.id;
    else if (user.school?.schulamtId) schulamtId = user.school.schulamtId;
    else if (user.teachers && user.teachers.length > 0) schulamtId = user.teachers[0].stammschule.schulamtId || undefined;

    try {
      await sendEmail(
        user.email,
        'Passwort zurücksetzen - Mobile Reserven',
        emailBody,
        schulamtId
      );
    } catch (mailError) {
      console.error('Failed to enqueue/send password reset email:', mailError);
    }

    return NextResponse.json(GENERIC_SUCCESS);
  } catch (error) {
    console.error('Password reset error:', error);
    return NextResponse.json(GENERIC_SUCCESS);
  }
}
