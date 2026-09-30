import { NextResponse } from 'next/server';
import { getSessionUser, setSessionCookie } from '@/lib/auth';

const headers = { 'Cache-Control': 'no-store' };

export async function POST() {
  try {
    // Check expiry, account status and session version before extending access.
    // Expired or revoked sessions must never be revived by this endpoint.
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401, headers });

    await setSessionCookie({ id: user.id, sessionVersion: user.sessionVersion });
    return new NextResponse(null, { status: 204, headers });
  } catch {
    console.error('Session refresh failed.');
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten.' }, { status: 500, headers });
  }
}
