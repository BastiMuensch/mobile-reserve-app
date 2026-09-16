import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { matchesRecoverySecret } from '@/lib/recoveryAccess';
import { revealSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!matchesRecoverySecret(request.headers.get('x-recovery-auth-token'), process.env.RECOVERY_AUTH_TOKEN)) return NextResponse.json({ ready: false }, { status: 403, headers });
  try {
    const [offices, profiles] = await Promise.all([
      prisma.user.count({ where: { role: 'SCHULAMT', isActive: true } }),
      prisma.schulamtProfile.findMany({ select: { smtpPass: true } }),
    ]);
    // Verify mail credentials are decryptable without connecting to any server.
    for (const profile of profiles) if (profile.smtpPass) revealSecret(profile.smtpPass);
    return NextResponse.json({ ready: true, generation: process.env.RECOVERY_GENERATION || 'baseline', offices }, { headers });
  } catch { return NextResponse.json({ ready: false }, { status: 503, headers }); }
}
