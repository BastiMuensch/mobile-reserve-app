export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getUpdateStatus } from '@/lib/updateCheck';

const dismissSchema = z.object({ version: z.string().min(1).max(80) });

function response(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

async function authorizedUser() {
  const user = await getSessionUser();
  if (!user) return { user: null, status: 401 } as const;
  if (user.role !== 'SCHULAMT') return { user: null, status: 403 } as const;
  return { user, status: 200 } as const;
}

function dismissalKey(userId: string): string {
  return `update-dismissed:${userId}`;
}

function hasAllowedOrigin(request: Request): boolean {
  const suppliedOrigin = request.headers.get('origin');
  if (!suppliedOrigin) return true;

  try {
    const allowedOrigins = new Set([new URL(request.url).origin]);
    if (process.env.NEXT_PUBLIC_APP_URL) allowedOrigins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
    return allowedOrigins.has(new URL(suppliedOrigin).origin);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const auth = await authorizedUser();
  if (!auth.user) return response({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);

  const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1';
  const [status, dismissedSetting] = await Promise.all([
    getUpdateStatus(forceRefresh),
    prisma.systemSetting.findUnique({ where: { id: dismissalKey(auth.user.id) } }),
  ]);

  return response({
    ...status,
    dismissed: Boolean(status.latestVersion && dismissedSetting?.value === status.latestVersion),
  });
}

export async function POST(request: Request) {
  const auth = await authorizedUser();
  if (!auth.user) return response({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  if (!hasAllowedOrigin(request)) return response({ error: 'Forbidden' }, 403);

  const parsed = dismissSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: 'Ungültige Versionsangabe.' }, 400);

  const status = await getUpdateStatus();
  if (!status.latestVersion || parsed.data.version !== status.latestVersion) {
    return response({ error: 'Diese Version wird derzeit nicht als Update angeboten.' }, 400);
  }

  await prisma.systemSetting.upsert({
    where: { id: dismissalKey(auth.user.id) },
    create: { id: dismissalKey(auth.user.id), value: status.latestVersion },
    update: { value: status.latestVersion },
  });

  return response({ success: true, dismissed: true, version: status.latestVersion });
}
