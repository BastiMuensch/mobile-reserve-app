import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Route handlers are invoked directly here, so provide the request-scoped
// storage that Next normally installs in its server runtime.
if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('login integration (skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => assert.ok(true));
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'auth-login-integration-test-secret';
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('login rejects wrong passwords, issues a secure session without a password, and invalidates it after a version change', async () => {
    const { POST } = await import('../src/app/api/auth/login/route');
    const { getSessionUser } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `login-${suffix}@test.local`;
    let userId = '';
    const originalNodeEnv = process.env.NODE_ENV;

    const invoke = async <T>(pathname: string, request: Request, handler: () => Promise<T>, onUpdateCookies?: (cookies: string[]) => void) => {
      const store = createRequestStoreForAPI(request as never, { pathname, search: new URL(request.url).search }, [] as never, onUpdateCookies, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () =>
        workUnitAsyncStorage.run(store, handler));
    };
    const loginRequest = (password: string) => new Request('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });

    try {
      const password = 'correct horse battery staple';
      const user = await prisma.user.create({
        data: { email, password: await bcrypt.hash(password, 12), role: 'SCHULAMT', sessionVersion: 9 },
      });
      userId = user.id;

      const wrongRequest = loginRequest('not the password');
      const wrong = await invoke('/api/auth/login', wrongRequest, () => POST(wrongRequest));
      assert.equal(wrong.status, 401);

      Reflect.set(process.env, 'NODE_ENV', 'production');
      const correctRequest = loginRequest(password);
      let emittedCookies: string[] = [];
      const correct = await invoke('/api/auth/login', correctRequest, () => POST(correctRequest), (cookies) => { emittedCookies = cookies; });
      assert.equal(correct.status, 200);
      const rawBody = await correct.text();
      assert.doesNotMatch(rawBody, /"password"/i);
      const body = JSON.parse(rawBody) as { success: boolean; user: { id: string; password?: string } };
      assert.equal(body.success, true);
      assert.equal(body.user.id, userId);
      assert.equal(body.user.password, undefined);
      const sessionCookie = emittedCookies.find(cookie => cookie.startsWith('session_token=')) || '';
      assert.match(sessionCookie, /session_token=/);
      assert.match(sessionCookie, /HttpOnly/i);
      assert.match(sessionCookie, /SameSite=Strict/i);
      assert.match(sessionCookie, /Secure/i);

      const token = /^session_token=([^;]+)/.exec(sessionCookie)?.[1];
      assert.ok(token, 'login must issue a readable session-token value');
      const authenticatedRequest = new Request('http://localhost/api/auth/me', { headers: { cookie: `session_token=${token}` } });
      const beforeIncrement = await invoke('/api/auth/me', authenticatedRequest, getSessionUser);
      assert.equal(beforeIncrement?.id, userId);
      await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
      const afterIncrement = await invoke('/api/auth/me', authenticatedRequest, getSessionUser);
      assert.equal(afterIncrement, null);
    } finally {
      if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
      else Reflect.set(process.env, 'NODE_ENV', originalNodeEnv);
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });
}
