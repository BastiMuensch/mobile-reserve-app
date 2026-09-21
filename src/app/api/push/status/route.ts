import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isDemoMode } from '@/lib/demoMode';
import { pushSubscriptionSchema } from '@/lib/pushSubscription';
import { getVapidKeys } from '@/lib/push';

// POST keeps the endpoint and encryption keys out of URL/access logs.
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'TEACHER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const parsed = pushSubscriptionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Ungültiges Push-Abo.' }, { status: 400 });
    if (await isDemoMode()) return NextResponse.json({ registered: false });
    const { endpoint, keys: { p256dh, auth } } = parsed.data;
    const subscription = await prisma.pushSubscription.findFirst({
      where: { endpoint, userId: user.id, p256dh, auth }, select: { id: true },
    });
    const { publicKey } = await getVapidKeys();
    return NextResponse.json({ registered: !!subscription, publicKey }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to check push registration:', error);
    return NextResponse.json({ error: 'Push-Status konnte nicht geprüft werden.' }, { status: 500 });
  }
}
