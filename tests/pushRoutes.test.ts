import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import webpush from 'web-push';
import { prisma } from '../src/lib/prisma';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

test('schools can activate, check and revoke their own device push; other roles and accounts stay isolated', async t => {
  const keys = webpush.generateVAPIDKeys();
  const overrides = {
    JWT_SECRET: 'push-route-test-secret', VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:push@example.invalid',
    DEMO_MODE: 'false', NOTIFICATION_SUPPRESSED: 'false',
  };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const { POST: subscribe } = await import('../src/app/api/push/subscribe/route');
  const { POST: status } = await import('../src/app/api/push/status/route');
  const { POST: unsubscribe } = await import('../src/app/api/push/unsubscribe/route');
  const { signToken } = await import('../src/lib/auth');
  const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
  const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
  const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');

  function mockMethod(model: any, method: string, implementation: (...args: any[]) => Promise<any>) {
    const original = model[method];
    model[method] = t.mock.fn(implementation);
    t.after(() => { model[method] = original; });
  }
  const users = [
    { id: 'school', role: 'SCHOOL', isActive: true },
    { id: 'other-school', role: 'SCHOOL', isActive: true },
    { id: 'teacher', role: 'TEACHER', isActive: true },
    { id: 'office', role: 'SCHULAMT', isActive: true },
    { id: 'inactive-school', role: 'SCHOOL', isActive: false },
  ].map(user => ({ ...user, sessionVersion: 0, mustChangePassword: false, teachers: [] }));
  type SavedSubscription = { id: string; userId: string; endpoint: string; p256dh: string; auth: string };
  let saved: SavedSubscription | null = null;
  const matches = (where: Record<string, unknown>) => saved !== null && Object.entries(where).every(([key, value]) => saved![key as keyof SavedSubscription] === value);
  mockMethod(prisma.user, 'findUnique', async ({ where }) => users.find(user => user.id === where.id));
  mockMethod(prisma.systemSetting, 'findUnique', async () => null);
  mockMethod(prisma.pushSubscription, 'upsert', async ({ create, update }) => {
    saved = saved ? { ...saved, ...update } : { id: 'subscription', ...create };
    return saved;
  });
  mockMethod(prisma.pushSubscription, 'findFirst', async ({ where }) => matches(where) ? saved : null);
  mockMethod(prisma.pushSubscription, 'findMany', async ({ where }) => matches(where) ? [saved] : []);
  mockMethod(prisma.pushSubscription, 'deleteMany', async ({ where }) => {
    const count = matches(where) ? 1 : 0;
    if (count) saved = null;
    return { count };
  });
  const send = t.mock.method(webpush, 'sendNotification', async () => ({ statusCode: 201, body: '', headers: {} }));
  const subscription = { endpoint: 'https://8.8.8.8/school-device', keys: { p256dh: 'key', auth: 'auth' } };

  async function invoke(action: 'subscribe' | 'status' | 'unsubscribe', userId: string | null, body: unknown = subscription) {
    const token = userId ? await signToken({ id: userId, sessionVersion: 0 }) : null;
    const pathname = `/api/push/${action}`;
    const request = new Request(`http://localhost${pathname}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { cookie: `session_token=${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
    const handler = { subscribe, status, unsubscribe }[action];
    return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never,
      () => workUnitAsyncStorage.run(store, () => handler(request)));
  }

  for (const action of ['subscribe', 'status'] as const) {
    assert.equal((await invoke(action, null)).status, 401);
    assert.equal((await invoke(action, 'inactive-school')).status, 401);
    assert.equal((await invoke(action, 'office')).status, 403);
  }
  const registered = await invoke('subscribe', 'school');
  assert.equal(registered.status, 201);
  assert.equal((await registered.json()).registered, true);
  assert.equal(send.mock.callCount(), 1, 'activation sends a welcome push to the school device');
  assert.equal((await (await invoke('status', 'school')).json()).registered, true);
  assert.equal((await (await invoke('status', 'other-school')).json()).registered, false);
  assert.equal((await (await invoke('status', 'school', { ...subscription, keys: { ...subscription.keys, auth: 'wrong-key' } })).json()).registered, false);
  await invoke('unsubscribe', 'other-school', { endpoint: subscription.endpoint });
  assert.equal((await (await invoke('status', 'school')).json()).registered, true);
  await invoke('unsubscribe', 'school', { endpoint: subscription.endpoint });
  assert.equal((await (await invoke('status', 'school')).json()).registered, false);
  assert.equal((await invoke('subscribe', 'teacher')).status, 201, 'teachers retain access');
});
