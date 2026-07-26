import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendPushNotification } from '@/lib/push';

export async function POST(req: Request) {
  try {
    const userSession = await getSessionUser();
    if (!userSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await req.json();

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return NextResponse.json({ error: 'Invalid subscription object' }, { status: 400 });
    }

    const { endpoint, keys: { p256dh, auth } } = subscription;

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
