import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { isWebRole } from '@/lib/webRoles';
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

// Per-email rate limiter (tighter limit to slow down credential stuffing on a single account)
const emailLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });

// IP-based rate limiter (broader limit per IP)
const ipLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });

export async function POST(request: Request) {
  try {
    // IP-based rate limiting
    const ip = getClientIp(request);
    const { success: ipAllowed } = ipLimiter.check(ip);
    if (!ipAllowed) {
      return NextResponse.json(
        { error: 'Zu viele Anmeldeversuche von dieser Adresse. Bitte warten Sie 15 Minuten.' },
        { status: 429 }
      );
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 8 * 1024) {
      return NextResponse.json({ error: 'Ungültige Anmeldedaten.' }, { status: 413 });
    }
    const parsed = LoginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Ungültige Anmeldedaten.' }, { status: 400 });
    }
    const { password } = parsed.data;
    const normalizedEmail = parsed.data.email.toLowerCase();

    const { success: emailAllowed } = emailLimiter.check(normalizedEmail);
    if (!emailAllowed) {
      return NextResponse.json(
        { error: 'Zu viele Anmeldeversuche. Bitte warten Sie 15 Minuten.' },
        { status: 429 }
      );
    }

    // Only fetch the fields needed to verify credentials first. The full
    // assignment tree is only loaded after the password has been verified,
    // so failed login attempts don't pay for that expensive query.
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, password: true, isActive: true, role: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const isMatch = user.password.startsWith('$2')
      ? await bcrypt.compare(password, user.password)
      : false; // No plaintext fallback – all passwords must be hashed

    if (!isMatch || !user.isActive) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // `ADMIN` remains a valid stored value for legacy installations, but it
    // intentionally has no regular web surface in the single-instance model.
    if (!isWebRole(user.role)) {
      return NextResponse.json({ error: 'Dieses technische Konto kann sich nicht an der Weboberfläche anmelden. Die Kontowiederherstellung erfolgt ausschließlich über den Server.' }, { status: 403 });
    }

    // Successful login: reset the per-email rate limiter
    emailLimiter.reset(normalizedEmail);

    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        school: true,
        // Einsatzdaten lädt das Lehrkraft-Dashboard über seinen geschützten,
        // aktualisierbaren Endpunkt; sie gehören nicht in die Login-Antwort.
        teachers: true,
      }
    });

    if (!fullUser) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    if (fullUser.role === 'TEACHER' && fullUser.teachers.some(teacher => teacher.status === 'PENDING')) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const cookieStore = await cookies();
    const token = await signToken({ id: fullUser.id, sessionVersion: fullUser.sessionVersion });

    cookieStore.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    const { password: storedPassword, ...userWithoutPassword } = fullUser;
    // Password is intentionally stripped before the session payload is returned.
    void storedPassword;
    return NextResponse.json({ success: true, user: userWithoutPassword });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
