import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendPushNotification } from '@/lib/push';
import { assertSafePushEndpoint } from '@/lib/pushEndpoint';
import { isDemoMode } from '@/lib/demoMode';

import { pushSubscriptionSchema } from '@/lib/pushSubscription';

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
    if (await isDemoMode()) return NextResponse.json({ error: 'Geräte-Push ist in dieser Demo deaktiviert.' }, { status: 403 });
    const parsed = pushSubscriptionSchema.safeParse(body);

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
    let warning: string | undefined;
    try {
      await sendPushNotification(userSession.id, {
        title: 'Push-Benachrichtigungen aktiv!',
        body: 'Sie erhalten nun sofort eine Benachrichtigung, wenn Ihnen ein neuer Einsatz zugewiesen wird.'
      }, endpoint);
    } catch (err) {
      console.error('Welcome push failed:', err);
      warning = 'Das Push-Abo wurde gespeichert, aber die Testnachricht konnte nicht versendet werden. Bitte versuchen Sie es später erneut.';
    }

    // A rejected/expired endpoint may have been removed by the test send.
    const registered = !!await prisma.pushSubscription.findFirst({
      where: { endpoint, userId: userSession.id, p256dh, auth }, select: { id: true },
    });
    return NextResponse.json({ success: true, registered, warning }, { status: 201 });
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
