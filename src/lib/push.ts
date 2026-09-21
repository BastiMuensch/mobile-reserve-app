import webpush from 'web-push';
import { prisma } from './prisma';
import { createSafePushAgent, isSafePushEndpoint, withTimeout } from './pushEndpoint';
import { privatePushPayload } from './pushLogout';
import { isDemoMode } from './demoMode';

const PUSH_NETWORK_TIMEOUT_MS = 8_000;

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

function maskEndpoint(endpoint: string): string {
  try {
    const parsed = new URL(endpoint);
    const path = parsed.pathname;
    const masked = path.length > 12 ? `${path.substring(0, 6)}...${path.substring(path.length - 4)}` : '...';
    return `${parsed.origin}${masked}`;
  } catch {
    return '***';
  }
}

export async function sendPushNotification(userId: string, _payload: { title: string, body: string, icon?: string }, endpoint?: string) {
  if (process.env.NOTIFICATION_SUPPRESSED === 'true') return;
  if (await isDemoMode()) return;
  void _payload; // Callers retain their event context; lock-screen content is always generic.
  // Defense in depth: Push is a Mobile-Reserve channel for teachers only.
  const recipient = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (recipient?.role !== 'TEACHER' || !recipient.isActive) return;

  const { publicKey, privateKey } = await getVapidKeys();
  
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || process.env.NEXT_PUBLIC_APP_URL || 'mailto:info@mobilereserve.digital',
    publicKey,
    privateKey
  );

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId, ...(endpoint ? { endpoint } : {}) }
  });

  const notifications = subscriptions.map(async (sub) => {
    // Revalidate at send time as well. This protects subscriptions saved by an
    // older release and reduces DNS-rebinding exposure between registration and
    // delivery. Do not delete on lookup failure: a temporary DNS outage must
    // not silently revoke a legitimate browser subscription.
    if (!await isSafePushEndpoint(sub.endpoint)) {
      console.warn('Unsafe or currently unresolved push endpoint skipped:', maskEndpoint(sub.endpoint));
      throw new Error('Push endpoint is unsafe or currently unresolved');
    }
    const agent = createSafePushAgent();
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth
      }
    };

    return withTimeout(
      webpush.sendNotification(pushSubscription, JSON.stringify(privatePushPayload()), {
        timeout: PUSH_NETWORK_TIMEOUT_MS - 1_000,
        agent,
      }),
      PUSH_NETWORK_TIMEOUT_MS,
    )
      .catch(async error => {
        // 404/410: subscription expired or was removed by the browser/push service.
        // Authentication failures (401/403) may be fixed by restoring server keys;
        // retain those subscriptions rather than silently revoking them.
        if (error.statusCode === 404 || error.statusCode === 410) {
          console.log(`Subscription dead (HTTP ${error.statusCode}). Deleting...`, maskEndpoint(sub.endpoint));
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {
            // Already deleted (e.g. by a concurrent send) - nothing to do.
          });
        }
        console.error('Error sending push notification', error);
        throw error;
      })
      .finally(() => agent.destroy());
  });

  const results = await Promise.allSettled(notifications);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    throw new AggregateError(failures.map(result => result.reason), 'Push delivery failed');
  }
}
