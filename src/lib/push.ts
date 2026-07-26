import webpush from 'web-push';
import { prisma } from './prisma';

// Helper to get or generate VAPID keys.
//
// Precedence:
//   (a) VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY from the environment, if BOTH are set
//       (operator-managed keys survive a lost/reset database).
//   (b) Values previously persisted in SystemSetting.
//   (c) Freshly generated + persisted (dev/first-run convenience only).
//
// If only one of the two env vars is set, that's a misconfiguration - we fail loudly
// instead of silently falling back to the DB (which could quietly generate/use a
// mismatched key pair).
export async function getVapidKeys() {
  const envPublicKey = process.env.VAPID_PUBLIC_KEY;
  const envPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (envPublicKey || envPrivateKey) {
    if (!envPublicKey || !envPrivateKey) {
      throw new Error(
        'VAPID configuration error: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must both be set (only one was found). ' +
        'Set both, or unset both to fall back to a database-generated key pair.'
      );
    }
    return { publicKey: envPublicKey, privateKey: envPrivateKey };
  }

  const settings = await prisma.systemSetting.findMany({
    where: {
      id: { in: ['vapidPublicKey', 'vapidPrivateKey'] }
    }
  });

  let publicKey = settings.find(s => s.id === 'vapidPublicKey')?.value;
  let privateKey = settings.find(s => s.id === 'vapidPrivateKey')?.value;

  if (!publicKey || !privateKey) {
    // Generate a candidate pair, but write + read it back inside a single transaction so that
    // concurrent callers racing to generate the first-ever key pair all converge on the same
    // persisted pair, rather than each writing their own and one silently winning the upsert
    // (which would strand any subscription created against the losing public key).
    const vapidKeys = webpush.generateVAPIDKeys();

    const persisted = await prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { id: 'vapidPublicKey' },
        update: {},
        create: { id: 'vapidPublicKey', value: vapidKeys.publicKey }
      });

      await tx.systemSetting.upsert({
        where: { id: 'vapidPrivateKey' },
        update: {},
        create: { id: 'vapidPrivateKey', value: vapidKeys.privateKey }
      });

      // Read back whatever actually ended up persisted - if another concurrent transaction
      // created the rows first, our `update: {}` is a no-op and this reflects their values.
      const rows = await tx.systemSetting.findMany({
        where: { id: { in: ['vapidPublicKey', 'vapidPrivateKey'] } }
      });
      return {
        publicKey: rows.find(r => r.id === 'vapidPublicKey')!.value,
        privateKey: rows.find(r => r.id === 'vapidPrivateKey')!.value,
      };
    });

    publicKey = persisted.publicKey;
    privateKey = persisted.privateKey;
  }

  return { publicKey, privateKey };
}

export async function sendPushNotification(userId: string, payload: { title: string, body: string, icon?: string }) {
  const { publicKey, privateKey } = await getVapidKeys();
  
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || process.env.NEXT_PUBLIC_APP_URL || 'mailto:info@mobilereserve.digital',
    publicKey,
    privateKey
  );

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId }
  });

  const notifications = subscriptions.map(sub => {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth
      }
    };

    return webpush.sendNotification(pushSubscription, JSON.stringify(payload))
      .catch(error => {
        // 404/410: subscription expired or was removed by the browser/push service.
        // 401/403: VAPID key mismatch (e.g. keys were regenerated) - the push service will
        // never accept this subscription again with our current keys either. In all four
        // cases the subscription is permanently dead, so we clean it up rather than let it
        // fail on every future assignment.
        if (error.statusCode === 404 || error.statusCode === 410 || error.statusCode === 401 || error.statusCode === 403) {
          console.log(`Subscription dead (HTTP ${error.statusCode}). Deleting...`, sub.endpoint);
          return prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {
            // Already deleted (e.g. by a concurrent send) - nothing to do.
          });
        }
        console.error('Error sending push notification', error);
      });
  });

  await Promise.all(notifications);
}
