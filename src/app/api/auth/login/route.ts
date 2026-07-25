import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

// Per-email rate limiter (tighter limit to slow down credential stuffing on a single account)
const emailLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });

// IP-based rate limiter (broader limit per IP)
const ipLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // IP-based rate limiting
    const ip = getClientIp(request);
    const { success: ipAllowed } = ipLimiter.check(ip);
    if (!ipAllowed) {
      return NextResponse.json(
        { error: 'Zu viele Anmeldeversuche von dieser Adresse. Bitte warten Sie 15 Minuten.' },
        { status: 429 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

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
      select: { id: true, password: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const isMatch = user.password.startsWith('$2')
      ? await bcrypt.compare(password, user.password)
      : false; // No plaintext fallback – all passwords must be hashed

    if (!isMatch) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Successful login: reset the per-email rate limiter
    emailLimiter.reset(normalizedEmail);

    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        school: true,
        teachers: {
          include: {
            assignments: {
              include: { request: { include: { school: true } } },
              orderBy: { date: 'asc' },
            },
          },
        }
      }
    });

    if (!fullUser) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const cookieStore = await cookies();
    const token = await signToken({ id: fullUser.id });

    cookieStore.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    const { password: _, ...userWithoutPassword } = fullUser;
    return NextResponse.json({ success: true, user: userWithoutPassword });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
