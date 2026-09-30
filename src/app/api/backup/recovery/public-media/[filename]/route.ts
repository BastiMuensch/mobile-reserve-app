import { NextResponse } from 'next/server';
import { matchesRecoverySecret } from '@/lib/recoveryAccess';
import { publicUploadResponse } from '@/lib/publicUploadResponse';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ filename: string }> }) {
  if (!matchesRecoverySecret(request.headers.get('x-recovery-auth-token'), process.env.RECOVERY_AUTH_TOKEN)) return new NextResponse(null, { status: 403 });
  const { filename } = await params;
  return publicUploadResponse(filename);
}
