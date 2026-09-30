import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '../src/lib/prisma';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

test('session renewal extends valid legacy sessions by 90 days and rejects expired or revoked access', async t => {
  const originalSecret = process.env.JWT_SECRET;
  const originalEnv = process.env.NODE_ENV;
  process.env.JWT_SECRET = 'session-renewal-test-secret';
  Reflect.set(process.env, 'NODE_ENV', 'production');
  t.after(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Reflect.set(process.env, 'NODE_ENV', originalEnv);
  });

  const { signToken, verifyToken, setSessionCookie } = await import('../src/lib/auth');
  const { POST } = await import('../src/app/api/auth/refresh/route');
  const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
  const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
  const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
  const key = new TextEncoder().encode(process.env.JWT_SECRET);
  const day = 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const identity = { id: 'session-user', sessionVersion: 3 };
  const baseUser = { ...identity, role: 'SCHULAMT', isActive: true, mustChangePassword: false, teachers: [] as { status: string }[] };
  let user: typeof baseUser | null = baseUser;
  const originalLookup = prisma.user.findUnique;
  const lookup = t.mock.fn(async () => user as never);
  prisma.user.findUnique = lookup as unknown as typeof prisma.user.findUnique;
  t.after(() => { prisma.user.findUnique = originalLookup; });

  async function invoke(token: string | null, handler: () => Promise<unknown> = POST) {
    const pathname = '/api/auth/refresh';
    const request = new Request(`https://app.example${pathname}`, {
      method: 'POST', headers: token ? { cookie: `session_token=${token}` } : {},
    });
    let emittedCookies: string[] = [];
    const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never,
      values => { emittedCookies = values; }, undefined, undefined);
    const response = await workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never,
      () => workUnitAsyncStorage.run(store, handler));
    return { response: response as Response, emittedCookies };
  }

  async function assertNinetyDays(cookies: string[]) {
    const cookie = cookies.find(value => value.startsWith('session_token=')) || '';
    assert.match(cookie, /Max-Age=7776000/i);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\//i);
    const token = /^session_token=([^;]+)/.exec(cookie)?.[1];
    assert.ok(token);
    const { payload } = await jwtVerify(token, key);
    assert.equal(payload.exp! - payload.iat!, 90 * day);
    assert.ok(payload.exp! >= now + 90 * day);
    assert.deepEqual(await verifyToken(token), identity);
  }

  await assertNinetyDays((await invoke(null, () => setSessionCookie(identity))).emittedCookies);
  const fresh = await signToken(identity);
  const { payload } = await jwtVerify(fresh, key);
  assert.equal(payload.exp! - payload.iat!, 90 * day);

  const legacy = await new SignJWT(identity).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now - 29 * day).setExpirationTime(now + day).sign(key);
  const renewed = await invoke(legacy);
  assert.equal(renewed.response.status, 204);
  assert.equal(renewed.response.headers.get('cache-control'), 'no-store');
  await assertNinetyDays(renewed.emittedCookies);
  for (const role of ['SCHOOL', 'TEACHER']) {
    user = { ...baseUser, role };
    const result = await invoke(fresh);
    assert.equal(result.response.status, 204);
    await assertNinetyDays(result.emittedCookies);
  }

  const expired = await new SignJWT(identity).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now - 91 * day).setExpirationTime(now - 1).sign(key);
  const invalidShape = await new SignJWT({ id: 1, sessionVersion: '3' })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1d').sign(key);
  for (const token of [null, `${fresh}tampered`, expired, invalidShape]) {
    const callsBefore = lookup.mock.callCount();
    const result = await invoke(token);
    assert.equal(result.response.status, 401);
    assert.deepEqual(result.emittedCookies, []);
    assert.equal(lookup.mock.callCount(), callsBefore, 'invalid tokens never reach account lookup');
  }
  for (const denied of [
    null,
    { ...baseUser, isActive: false },
    { ...baseUser, sessionVersion: 4 },
    { ...baseUser, mustChangePassword: true },
    { ...baseUser, role: 'ADMIN' },
    { ...baseUser, role: 'TEACHER', teachers: [{ status: 'PENDING' }] },
  ]) {
    user = denied;
    const result = await invoke(fresh);
    assert.equal(result.response.status, 401);
    assert.deepEqual(result.emittedCookies, [], 'denied accounts must not receive a renewed cookie');
  }
});
