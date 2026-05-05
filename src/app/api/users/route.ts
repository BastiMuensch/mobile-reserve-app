import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';

// This route is intentionally locked down. There is no legitimate need for a
// public endpoint that returns all users. Admins can manage users via the
// existing teacher and school management routes.
export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Even for SCHULAMT, we return a 403 — use the dedicated routes instead.
  return NextResponse.json({ error: 'Use /api/teachers or /api/schools instead.' }, { status: 403 });
}
