import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { matchesRecoverySecret, readRecoveryJson } from '@/lib/recoveryAccess';
import { createRateLimiter } from '@/lib/rateLimit';

export const runtime = 'nodejs';
const limit = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });
const reply = (status: number) => NextResponse.json({ authorized: status === 200 }, { status, headers: { 'Cache-Control': 'no-store' } });

// Called only by the independently authenticated recovery gateway. The normal
// session remains necessary for school-office authorization; the control token
// alone cannot turn a teacher or an anonymous visitor into an administrator.
export async function POST(request: Request) {
  if (!matchesRecoverySecret(request.headers.get('x-recovery-auth-token'), process.env.RECOVERY_AUTH_TOKEN)) return reply(403);
  if (!limit.check('recovery-authorize').success) return reply(429);
  try {
    const body = await readRecoveryJson(request);
    if (typeof body.setupToken === 'string') {
      const [users, marker] = await Promise.all([prisma.user.count(), prisma.systemSetting.findUnique({ where: { id: 'initialSetupCompleted' } })]);
      return reply(users === 0 && !marker && matchesRecoverySecret(body.setupToken, process.env.SETUP_TOKEN) ? 200 : 403);
    }
    const user = await getSessionUser();
    if (!user || user.role !== 'SCHULAMT' || typeof body.password !== 'string' || body.password.length > 200) return reply(403);
    return reply(await bcrypt.compare(body.password, user.password) ? 200 : 403);
  } catch { return reply(403); }
}
