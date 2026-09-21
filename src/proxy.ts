import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_AUTH_ROUTES = [
  '/api/auth/login',
  '/api/auth/reset',
  '/api/auth/reset/confirm',
  '/api/auth/logout',
  '/api/public/settings',
  '/api/setup/status',
  '/api/setup/register',
  '/api/setup/geocode',
  '/api/setup/preview',
  '/api/setup/register-teacher',
  '/api/geocode/postal-code',
  '/api/cron/cleanup',
  '/api/backup/recovery/authorize',
  '/api/backup/recovery/readiness',
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const recoveryInternalMedia = pathname.startsWith('/api/backup/recovery/public-media/');
  if (process.env.RECOVERY_READ_ONLY === 'true' && pathname !== '/api/backup/recovery/readiness' && !recoveryInternalMedia) {
    return NextResponse.json({ error: 'Wiederherstellung wird geprüft. Bitte warten.' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
  }

  // Protect /api/* routes
  if (pathname.startsWith('/api/')) {
    if (PUBLIC_AUTH_ROUTES.some((route) => pathname === route) || recoveryInternalMedia) {
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

  // Nonce-based CSP for HTML page requests
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
    worker-src 'self';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob: https://*.bayernwolke.de;
    font-src 'self';
    connect-src 'self' https://*.bayernwolke.de;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, ' ').trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('Content-Security-Policy', cspHeader);

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|map-markers|uploads).*)',
  ],
};
