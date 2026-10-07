export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCurrentVersion } from '@/lib/updateCheck';
import { getReleaseNotice, releaseSeenKey } from '@/lib/releaseNotes';

const acknowledgeSchema = z.object({ version: z.string().min(1).max(80) }).strict();

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

async function authorizedUser() {
  const user = await getSessionUser();
  if (!user) return { user: null, status: 401 } as const;
  if (user.role !== 'SCHULAMT' && user.role !== 'SCHOOL') return { user: null, status: 403 } as const;
  return { user, status: 200 } as const;
}

function hasAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const allowed = new Set([new URL(request.url).origin]);
    if (process.env.NEXT_PUBLIC_APP_URL) allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export async function GET() {
  const auth = await authorizedUser();
  if (!auth.user) return response({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);

  const notice = getReleaseNotice(getCurrentVersion(), auth.user.role);
  if (!notice) return response({ notice: null });

  const seen = await prisma.systemSetting.findUnique({
    where: { id: releaseSeenKey(auth.user.id, notice.version) },
  });
  return response({ notice: seen ? null : notice });
}

export async function POST(request: Request) {
  const auth = await authorizedUser();
  if (!auth.user) return response({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  if (!hasAllowedOrigin(request)) return response({ error: 'Forbidden' }, 403);

  const parsed = acknowledgeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: 'Ungültige Versionsangabe.' }, 400);
  const notice = getReleaseNotice(getCurrentVersion(), auth.user.role);
  if (!notice || parsed.data.version !== notice.version) {
    return response({ error: 'Dieser Hinweis gehört nicht zur installierten Version.' }, 409);
  }

  // One key per account and installed version makes acknowledgements idempotent,
  // independent of devices, other users, update-availability dismissals and rollbacks.
  const id = releaseSeenKey(auth.user.id, notice.version);
  await prisma.systemSetting.upsert({
    where: { id },
    create: { id, value: new Date().toISOString() },
    update: {},
  });
  return response({ success: true });
}
