import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendPushNotification } from '@/lib/push';
import { assertSafePushEndpoint } from '@/lib/pushEndpoint';

import { z } from 'zod';

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url('Ungültige Endpunkt-URL.').max(1000, 'Endpunkt-URL zu lang.'),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh Key erforderlich.').max(255, 'p256dh Key zu lang.'),
    auth: z.string().min(1, 'auth Key erforderlich.').max(255, 'auth Key zu lang.'),
  }),
});

export async function POST(req: Request) {
  try {
    const userSession = await getSessionUser();
    if (!userSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (userSession.role !== 'TEACHER') {
      return NextResponse.json({ error: 'Push-Benachrichtigungen sind nur für Lehrkräfte verfügbar.' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = PushSubscriptionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Ungültiges Subscription-Objekt.' }, { status: 400 });
    }

    const { endpoint, keys: { p256dh, auth } } = parsed.data;

    // Do this before persisting and before sending the welcome notification.
    // A PushSubscription is browser-provided input, not a trusted server URL.
    try {
      await assertSafePushEndpoint(endpoint);
    } catch {
      return NextResponse.json({ error: 'Der Push-Endpunkt ist nicht sicher oder derzeit nicht erreichbar.' }, { status: 400 });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId: userSession.id,
        p256dh,
        auth
      },
      create: {
        userId: userSession.id,
        endpoint,
        p256dh,
        auth
      }
    });

    // Send a welcome push notification so the user knows it works. Awaited so it can't be lost
    // if the process exits right after the response is sent - but a failure here must not fail
    // the subscription itself, since the subscription was already persisted successfully above.
    try {
      await sendPushNotification(userSession.id, {
        title: 'Push-Benachrichtigungen aktiv!',
        body: 'Sie erhalten nun sofort eine Benachrichtigung, wenn Ihnen ein neuer Einsatz zugewiesen wird.'
      });
    } catch (err) {
      console.error('Welcome push failed:', err);
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
