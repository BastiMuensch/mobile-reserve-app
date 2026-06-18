import webpush from 'web-push';
import { prisma } from './prisma';

// Helper to get or generate VAPID keys
export async function getVapidKeys() {
  const settings = await prisma.systemSetting.findMany({
    where: {
      id: { in: ['vapidPublicKey', 'vapidPrivateKey'] }
    }
  });

  let publicKey = settings.find(s => s.id === 'vapidPublicKey')?.value;
  let privateKey = settings.find(s => s.id === 'vapidPrivateKey')?.value;

  if (!publicKey || !privateKey) {
    const vapidKeys = webpush.generateVAPIDKeys();
    publicKey = vapidKeys.publicKey;
    privateKey = vapidKeys.privateKey;

    await prisma.systemSetting.upsert({
      where: { id: 'vapidPublicKey' },
      update: { value: publicKey },
      create: { id: 'vapidPublicKey', value: publicKey }
    });
    
    await prisma.systemSetting.upsert({
      where: { id: 'vapidPrivateKey' },
      update: { value: privateKey },
      create: { id: 'vapidPrivateKey', value: privateKey }
    });
  }

  return { publicKey, privateKey };
}

export async function sendPushNotification(userId: string, payload: { title: string, body: string, icon?: string }) {
  const { publicKey, privateKey } = await getVapidKeys();
  
  webpush.setVapidDetails(
    'mailto:admin@mobile-digital.local',
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
        if (error.statusCode === 404 || error.statusCode === 410) {
          // Subscription has expired or is no longer valid
          console.log('Subscription expired. Deleting...', sub.endpoint);
          return prisma.pushSubscription.delete({ where: { id: sub.id } });
        }
        console.error('Error sending push notification', error);
      });
  });

  await Promise.all(notifications);
}
