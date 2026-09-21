import test from 'node:test';
import assert from 'node:assert/strict';
import { isAppleMobileDevice, isPushRegistered, readyPushRegistration, registerDevicePush } from '../src/lib/pushClient';

const publicKey = Buffer.from([4, 100, 200, 255]).toString('base64url');

function device() {
  const sub = {
    endpoint: 'https://push.example.net/device',
    options: { applicationServerKey: Uint8Array.from([4, 100, 200, 255]).buffer },
    unsubscribe: async () => true,
    toJSON: () => ({ endpoint: 'https://push.example.net/device', keys: { p256dh: 'key', auth: 'auth' } }),
  } as unknown as PushSubscription;
  const registration = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } } as unknown as ServiceWorkerRegistration;
  return { sub, registration };
}

test('Apple installation guidance includes Chrome on iPhone and desktop-mode iPads', () => {
  assert.equal(isAppleMobileDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 CriOS/140', 5), true);
  assert.equal(isAppleMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605', 5), true);
  assert.equal(isAppleMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605', 0), false);
  assert.equal(isAppleMobileDevice('Mozilla/5.0 (Linux; Android 15)', 5), false);
});

test('local subscription without server registration does not count as active', async t => {
  const { sub } = device();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ registered: false, publicKey }));
  assert.equal(await isPushRegistered(null), false);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(await isPushRegistered(sub), false);
  fetchMock.mock.mockImplementation(async () => Response.json({ registered: true, publicKey }));
  assert.equal(await isPushRegistered(sub), true);
  fetchMock.mock.mockImplementation(async () => Response.json({ registered: true, publicKey: 'BAUGBw' }));
  assert.equal(await isPushRegistered(sub), false);
  fetchMock.mock.mockImplementation(async () => Response.json({ error: 'Server offline' }, { status: 503 }));
  await assert.rejects(isPushRegistered(sub), /Server offline/);
});

test('first installation subscribes and saves the device before reporting success', async t => {
  const { sub, registration } = device();
  t.mock.method(registration.pushManager, 'getSubscription', async () => null);
  const subscribe = t.mock.method(registration.pushManager, 'subscribe', async () => sub);
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string | URL | Request, init?: RequestInit) => {
    paths.push(String(path));
    if (String(path).endsWith('vapidPublicKey')) return Response.json({ publicKey });
    assert.deepEqual(JSON.parse(String(init?.body)), sub.toJSON());
    return Response.json({ registered: true });
  });
  assert.deepEqual(await registerDevicePush(registration), { warning: undefined });
  assert.equal(subscribe.mock.callCount(), 1);
  assert.deepEqual(subscribe.mock.calls[0].arguments[0], { userVisibleOnly: true, applicationServerKey: Uint8Array.from([4, 100, 200, 255]) });
  assert.deepEqual(paths, ['/api/push/vapidPublicKey', '/api/push/subscribe']);
});

test('failed server save can be retried using the existing local subscription', async t => {
  const { sub, registration } = device();
  const subscribe = t.mock.method(registration.pushManager, 'subscribe', async () => sub);
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (path: string | URL | Request) => {
    if (String(path).endsWith('vapidPublicKey')) return Response.json({ publicKey });
    return fail ? Response.json({ error: 'Nicht gespeichert' }, { status: 500 }) : Response.json({ registered: true, warning: 'Testversand fehlgeschlagen' });
  });
  await assert.rejects(registerDevicePush(registration), /Nicht gespeichert/);
  fail = false;
  assert.deepEqual(await registerDevicePush(registration), { warning: 'Testversand fehlgeschlagen' });
  assert.equal(subscribe.mock.callCount(), 0);
});

test('expired subscriptions are removed locally so a new activation can recover', async t => {
  const { sub, registration } = device();
  const unsubscribe = t.mock.method(sub, 'unsubscribe', async () => true);
  t.mock.method(globalThis, 'fetch', async (path: string | URL | Request) => Response.json(
    String(path).endsWith('vapidPublicKey') ? { publicKey } : { registered: false },
  ));
  await assert.rejects(registerDevicePush(registration), /abgelaufen/);
  assert.equal(unsubscribe.mock.callCount(), 1);
});

test('activation renews subscriptions after the server VAPID key changes', async t => {
  const { sub, registration } = device();
  const unsubscribe = t.mock.method(sub, 'unsubscribe', async () => true);
  const subscribe = t.mock.method(registration.pushManager, 'subscribe', async () => sub);
  t.mock.method(globalThis, 'fetch', async (path: string | URL | Request) => Response.json(
    String(path).endsWith('vapidPublicKey') ? { publicKey: 'BAUGBw' } : { registered: true },
  ));
  await registerDevicePush(registration);
  assert.equal(unsubscribe.mock.callCount(), 1);
  assert.equal(subscribe.mock.callCount(), 1);
});

test('service worker failures and stalled activation produce actionable errors', async () => {
  const failed = { register: async () => { throw new Error('CSP blocked'); } } as unknown as ServiceWorkerContainer;
  await assert.rejects(readyPushRegistration(failed), /CSP blocked/);
  const stalled = { register: async () => ({}), ready: new Promise(() => {}) } as unknown as ServiceWorkerContainer;
  await assert.rejects(readyPushRegistration(stalled, 5), /App neu/);
});
