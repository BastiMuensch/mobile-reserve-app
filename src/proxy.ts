import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_AUTH_ROUTES = [
  '/api/auth/login',
  '/api/auth/reset',
  '/api/auth/reset/confirm',
  '/api/auth/logout',
  '/api/public/settings',
  '/api/public/schools',
  '/api/setup/status',
  '/api/setup/register',
  '/api/setup/register-teacher',
  '/api/cron/cleanup',
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /api/* routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Allow public auth routes
  if (PUBLIC_AUTH_ROUTES.some((route) => pathname === route)) {
    return NextResponse.next();
  }

  const token = request.cookies.get('session_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secretKey = process.env.JWT_SECRET;
  if (!secretKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    const key = new TextEncoder().encode(secretKey);
    await jwtVerify(token, key);
    return NextResponse.next();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

export const config = {
  matcher: ['/api/:path*'],
};
