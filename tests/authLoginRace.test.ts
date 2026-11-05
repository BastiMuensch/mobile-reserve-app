import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

test('login cannot turn a credential checked before a reset into a current session', async t => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'isolated-login-race-test-secret';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  const { POST } = await import('../src/app/api/auth/login/route');
  const { getSessionUser, verifyToken } = await import('../src/lib/auth');
  const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
  const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
  const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
  const password = 'password before reset';
  const before = {
    id: 'race-test-account', email: 'race@example.test', password: await bcrypt.hash(password, 4),
    sessionVersion: 9, role: 'SCHULAMT', isActive: true, mustChangePassword: false, teachers: [], school: null,
  };
  const afterReset = { ...before, password: await bcrypt.hash('password after reset', 4), sessionVersion: 10 };
  let reads = 0;
  let current = before;
  const originalLookup = prisma.user.findUnique;
  prisma.user.findUnique = t.mock.fn(async () => (++reads === 1 ? before : current)) as unknown as typeof prisma.user.findUnique;
  t.after(() => { prisma.user.findUnique = originalLookup; });

  const invoke = async <T>(request: Request, handler: () => Promise<T>, onUpdateCookies?: (values: string[]) => void) => {
    const { pathname, search } = new URL(request.url);
    const store = createRequestStoreForAPI(request as never, { pathname, search }, [] as never, onUpdateCookies, undefined, undefined);
    return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never,
      () => workUnitAsyncStorage.run(store, handler));
  };
  const login = async () => {
    reads = 0;
    let cookies: string[] = [];
    const request = new Request('https://app.example/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: before.email, password }),
    });
    const response = await invoke(request, () => POST(request), values => { cookies = values; });
    return { response, cookies };
  };

  await t.test('an unchanged account receives a usable version-bound session', async () => {
    const result = await login();
    assert.equal(result.response.status, 200);
    const token = /^session_token=([^;]+)/.exec(result.cookies.find(value => value.startsWith('session_token=')) || '')?.[1];
    assert.ok(token);
    assert.deepEqual(await verifyToken(token), { id: before.id, sessionVersion: before.sessionVersion });
    const request = new Request('https://app.example/api/auth/me', { headers: { cookie: `session_token=${token}` } });
    assert.equal((await invoke(request, getSessionUser))?.id, before.id);
    // A reset after the final login read still invalidates its old-version token.
    current = afterReset;
    assert.equal(await invoke(request, getSessionUser), null);
  });

  for (const [label, changed] of [
    ['a concurrent password reset', afterReset],
    ['a concurrent version revocation', { ...before, sessionVersion: 10 }],
    ['a changed password without a version change', { ...before, password: afterReset.password }],
    ['a deactivated account', { ...before, isActive: false }],
    ['a retired web role', { ...before, role: 'ADMIN' }],
  ] as const) {
    await t.test(`rejects ${label} without issuing any cookie`, async () => {
      current = changed;
      const result = await login();
      assert.equal(result.response.status, 401);
      assert.deepEqual(result.cookies, []);
    });
  }
});
