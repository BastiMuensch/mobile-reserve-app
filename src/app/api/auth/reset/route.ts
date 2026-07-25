import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import crypto from 'crypto';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

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
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'E-Mail ist erforderlich' }, { status: 400 });
    }

    // IP-based rate limiting
    const ip = getClientIp(request);
    const { success: ipAllowed } = ipLimiter.check(ip);
    if (!ipAllowed) {
      return NextResponse.json(GENERIC_SUCCESS);
    }

    const normalizedEmail = email.trim().toLowerCase();

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

    if (!user) {
      // Return success anyway to prevent email enumeration
      return NextResponse.json(GENERIC_SUCCESS);
    }

    // Basis-URL zuerst auflösen: ohne sie wäre der versendete Link unbrauchbar,
    // dann lieber gar keinen Token anlegen.
    const baseUrl = resolveAppBaseUrl(request);
    if (!baseUrl) {
      return NextResponse.json(GENERIC_SUCCESS);
    }

    // Invalidate any previously issued, still-open tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null }
    });

    // Generate a cryptographically secure token. Only its hash is persisted;
    // the plaintext token is sent to the user via email and never stored.
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      }
    });

    const resetLink = `${baseUrl}/reset?token=${token}`;

    const emailBody = `Hallo,\n\nfür Ihr Konto im Mobile Reserven Portal wurde ein Zurücksetzen des Passworts angefordert.\n\nKlicken Sie auf folgenden Link, um ein neues Passwort zu vergeben (gültig für 1 Stunde):\n\n${resetLink}\n\nWenn Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.`;

    let schulamtId: string | undefined;
    if (user.role === 'SCHULAMT') schulamtId = user.id;
    else if (user.school?.schulamtId) schulamtId = user.school.schulamtId;
    else if (user.teachers && user.teachers.length > 0) schulamtId = user.teachers[0].stammschule.schulamtId || undefined;

    await sendEmail(
      user.email,
      'Passwort zurücksetzen - Mobile Reserven',
      emailBody,
      schulamtId
    );

    return NextResponse.json(GENERIC_SUCCESS);
  } catch (error) {
    console.error('Password reset error:', error);
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten' }, { status: 500 });
  }
}
