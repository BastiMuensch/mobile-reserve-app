import { handleUnauthorized } from './authClient';

export function isAppleMobileDevice(userAgent: string, maxTouchPoints: number) {
  return /iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

export function urlBase64ToUint8Array(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

export function usesPushKey(subscription: PushSubscription, publicKey: string) {
  const current = subscription.options.applicationServerKey;
  const expected = urlBase64ToUint8Array(publicKey);
  return !!current && current.byteLength === expected.length &&
    new Uint8Array(current).every((byte, index) => byte === expected[index]);
}

export async function readyPushRegistration(container: ServiceWorkerContainer, timeoutMs = 10_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      container.register('/sw.js', { updateViaCache: 'none' }).then(() => container.ready),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Die Benachrichtigungen konnten nicht vorbereitet werden. Bitte laden Sie die App neu und versuchen Sie es erneut.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function pushRequest(path: string, subscription?: PushSubscription) {
  const response = await fetch(path, {
    ...(subscription ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription),
    } : {}),
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401) handleUnauthorized();
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Der Push-Server ist gerade nicht erreichbar. Bitte versuchen Sie es erneut.');
  return data;
}

export async function isPushRegistered(subscription: PushSubscription | null) {
  if (!subscription) return false;
  const data = await pushRequest('/api/push/status', subscription);
  return data.registered === true && typeof data.publicKey === 'string' && usesPushKey(subscription, data.publicKey);
}

export async function registerDevicePush(registration: ServiceWorkerRegistration) {
  const { publicKey } = await pushRequest('/api/push/vapidPublicKey');
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !usesPushKey(subscription, publicKey)) {
    if (!await subscription.unsubscribe()) throw new Error('Das alte Push-Abo konnte nicht erneuert werden. Bitte laden Sie die App neu.');
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const data = await pushRequest('/api/push/subscribe', subscription);
  if (data.registered !== true) {
    await subscription.unsubscribe();
    throw new Error('Das Push-Abo ist abgelaufen. Bitte tippen Sie erneut auf „Push aktivieren“.');
  }
  return { warning: typeof data.warning === 'string' ? data.warning : undefined };
}
