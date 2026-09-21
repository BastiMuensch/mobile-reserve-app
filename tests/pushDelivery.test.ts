import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { prisma } from '../src/lib/prisma';
import { sendPushNotification } from '../src/lib/push';

const payload = { title: 'Private assignment title', body: 'Private assignment details' };
const subscriptions = [
  { id: 'first', userId: 'teacher', endpoint: 'https://8.8.8.8/first', p256dh: 'key', auth: 'auth' },
  { id: 'second', userId: 'teacher', endpoint: 'https://8.8.8.8/second', p256dh: 'key', auth: 'auth' },
];

function mockPrismaMethod(t: TestContext, model: any, method: string, implementation: (...args: any[]) => Promise<any>) {
  // Prisma delegates expose methods through a Proxy, without method descriptors.
  const original = model[method];
  const mocked = t.mock.fn(implementation);
  model[method] = mocked;
  t.after(() => { model[method] = original; });
  return mocked;
}

function setup(t: TestContext) {
  const keys = webpush.generateVAPIDKeys();
  const overrides = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:push@example.org', DEMO_MODE: 'false', NOTIFICATION_SUPPRESSED: 'false' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  mockPrismaMethod(t, prisma.systemSetting, 'findUnique', async () => null);
  mockPrismaMethod(t, prisma.user, 'findUnique', async () => ({ role: 'TEACHER', isActive: true }));
  const findMany = mockPrismaMethod(t, prisma.pushSubscription, 'findMany', async () => subscriptions);
  const remove = mockPrismaMethod(t, prisma.pushSubscription, 'delete', async () => ({}));
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  return { findMany, remove };
}

test('delivery reports failures after attempting all devices and keeps transient subscriptions', async t => {
  const { remove } = setup(t);
  const attempts: string[] = [];
  let secondFinished = false;
  t.mock.method(webpush, 'sendNotification', async (subscription: webpush.PushSubscription) => {
    attempts.push(subscription.endpoint);
    if (subscription.endpoint.endsWith('first')) throw new Error('Temporary transport failure');
    await new Promise(resolve => setTimeout(resolve, 5));
    secondFinished = true;
    return { statusCode: 201, body: '', headers: {} };
  });
  await assert.rejects(sendPushNotification('teacher', payload), AggregateError);
  assert.equal(secondFinished, true);
  assert.deepEqual(attempts, subscriptions.map(sub => sub.endpoint));
  assert.equal(remove.mock.callCount(), 0);
});

for (const statusCode of [401, 403, 404, 410]) {
  test(`delivery reports HTTP ${statusCode} and only removes permanently expired endpoints`, async t => {
    const { remove } = setup(t);
    t.mock.method(webpush, 'sendNotification', async () => { throw Object.assign(new Error('Rejected'), { statusCode }); });
    await assert.rejects(sendPushNotification('teacher', payload), AggregateError);
    assert.equal(remove.mock.callCount(), [404, 410].includes(statusCode) ? 2 : 0);
  });
}

test('welcome push scopes the lookup to the current device and retains private lock-screen text', async t => {
  const { findMany } = setup(t);
  findMany.mock.mockImplementation(async () => [subscriptions[0]]);
  const send = t.mock.method(webpush, 'sendNotification', async (_subscription: webpush.PushSubscription, body?: string | Buffer | null) => {
    assert.ok(body);
    assert.equal(String(body).includes('Private assignment'), false);
    return { statusCode: 201, body: '', headers: {} };
  });
  await sendPushNotification('teacher', payload, subscriptions[0].endpoint);
  assert.deepEqual(findMany.mock.calls[0].arguments, [{ where: { userId: 'teacher', endpoint: subscriptions[0].endpoint } }]);
  assert.equal(send.mock.callCount(), 1);
});

test('unsafe endpoints fail visibly without attempting a network request', async t => {
  const { findMany, remove } = setup(t);
  findMany.mock.mockImplementation(async () => [{ ...subscriptions[0], endpoint: 'https://127.0.0.1/blocked' }]);
  t.mock.method(console, 'warn', () => {});
  const send = t.mock.method(webpush, 'sendNotification', async () => ({ statusCode: 201, body: '', headers: {} }));
  await assert.rejects(sendPushNotification('teacher', payload), AggregateError);
  assert.equal(send.mock.callCount(), 0);
  assert.equal(remove.mock.callCount(), 0);
});
