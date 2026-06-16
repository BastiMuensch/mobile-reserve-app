import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

// Simple in-memory rate limiter for login attempts
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// IP-based rate limiter (broader limit per IP)
const ipLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });

function cleanupAttempts(map: Map<string, {count: number; firstAttempt: number}>) {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.firstAttempt > WINDOW_MS) map.delete(key);
  }
}

function isRateLimited(email: string): boolean {
  cleanupAttempts(loginAttempts);
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    loginAttempts.set(email, { count: 1, firstAttempt: now });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

function resetRateLimit(email: string) {
  loginAttempts.delete(email);
}

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

    if (isRateLimited(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Zu viele Anmeldeversuche. Bitte warten Sie 15 Minuten.' },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
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

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const isMatch = user.password.startsWith('$2') 
      ? await bcrypt.compare(password, user.password)
      : false; // No plaintext fallback – all passwords must be hashed

    if (!isMatch) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Successful login: reset rate limiter
    resetRateLimit(email.toLowerCase());

    const cookieStore = await cookies();
    const token = await signToken({ id: user.id });
    
    cookieStore.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 1 week
    });

    const { password: _, ...userWithoutPassword } = user;
    return NextResponse.json({ success: true, user: userWithoutPassword });

  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
