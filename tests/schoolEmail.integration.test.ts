import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('school email integration (requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'school-email-integration-test-secret';
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('schools change only their own email after password confirmation and renew account access', async () => {
    const { PATCH } = await import('../src/app/api/school/account/route');
    const { POST: login } = await import('../src/app/api/auth/login/route');
    const { signToken, getSessionUser } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = crypto.randomUUID();
    const password = 'a school password for email changes';
    const originalEmail = `school-original-${suffix}@test.local`;
    const nextEmail = `school-new-${suffix}@test.local`;
    const userIds: string[] = [];
    const schoolIds: string[] = [];
    const invoke = async <T>(pathname: string, request: Request, handler: () => Promise<T>, onUpdateCookies?: (values: string[]) => void) => {
      const store = createRequestStoreForAPI(request as never, { pathname, search: new URL(request.url).search }, [] as never, onUpdateCookies, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, handler));
    };
    const patch = async (token: string | null, body: unknown, onCookies?: (values: string[]) => void) => {
      const request = new Request('http://localhost/api/school/account', {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-forwarded-for': crypto.randomUUID(), ...(token ? { cookie: `session_token=${token}` } : {}) },
        body: JSON.stringify(body),
      });
      return invoke('/api/school/account', request, () => PATCH(request), onCookies);
    };
    const session = async (token: string) => {
      const request = new Request('http://localhost/api/auth/me', { headers: { cookie: `session_token=${token}` } });
      return invoke('/api/auth/me', request, getSessionUser);
    };

    try {
      const school = await prisma.school.create({ data: { name: `Email school ${suffix}`, address: 'Testweg 1', type: 'GRUNDSCHULE' } });
      schoolIds.push(school.id);
      const hash = await bcrypt.hash(password, 12);
      const own = await prisma.user.create({ data: { email: originalEmail, password: hash, role: 'SCHOOL', schoolId: school.id, sessionVersion: 3 } });
      userIds.push(own.id);
      const other = await prisma.user.create({ data: { email: `other-email-${suffix}@test.local`, password: hash, role: 'SCHULAMT' } });
      userIds.push(other.id);
      const token = await signToken({ id: own.id, sessionVersion: own.sessionVersion });
      const otherToken = await signToken({ id: other.id, sessionVersion: other.sessionVersion });
      const data = { email: nextEmail, currentPassword: password };
      assert.equal((await patch(null, data)).status, 401);
      assert.equal((await patch(otherToken, data)).status, 403);
      assert.equal((await patch(token, { ...data, email: 'broken email' })).status, 400);
      assert.equal((await patch(token, { ...data, schoolId: school.id })).status, 400, 'request cannot select the target school');
      assert.equal((await patch(token, { ...data, currentPassword: 'wrong password' })).status, 401);
      assert.equal((await patch(token, { ...data, email: other.email })).status, 409);
      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: own.id } });
      assert.equal(unchanged.email, originalEmail);
      assert.equal(unchanged.sessionVersion, 3);

      await prisma.passwordResetToken.create({ data: { userId: own.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
      let changedCookies: string[] = [];
      const changed = await patch(token, { ...data, email: `  ${nextEmail.toUpperCase()}  ` }, values => { changedCookies = values; });
      assert.equal(changed.status, 200);
      assert.deepEqual(await changed.json(), { success: true, email: nextEmail });
      const renewedToken = /^session_token=([^;]+)/.exec(changedCookies.find(value => value.startsWith('session_token=')) || '')?.[1];
      assert.ok(renewedToken);
      assert.equal(await session(token), null, 'old sessions are invalidated');
      assert.equal((await session(renewedToken))?.email, nextEmail, 'current session remains valid');
      assert.equal((await patch(token, { ...data, email: originalEmail })).status, 401, 'old session cannot revert address');
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: own.id, usedAt: null } }), 0);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).email, other.email);
      const updated = await prisma.user.findUniqueOrThrow({ where: { id: own.id } });
      assert.equal(updated.password, hash, 'password stays unchanged');
      assert.equal(updated.sessionVersion, 4);

      for (const [email, expected] of [[originalEmail, 401], [nextEmail, 200]] as const) {
        const request = new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': crypto.randomUUID() }, body: JSON.stringify({ email, password }) });
        assert.equal((await invoke('/api/auth/login', request, () => login(request))).status, expected);
      }
      assert.equal((await patch(renewedToken, { ...data, email: nextEmail })).status, 200, 'resaving unchanged address does not revoke current session');
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: own.id } })).sessionVersion, 4);
      await prisma.user.update({ where: { id: own.id }, data: { mustChangePassword: true } });
      assert.equal((await patch(renewedToken, { ...data, email: originalEmail })).status, 401, 'temporary-password restriction is preserved');
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
      await prisma.$disconnect();
    }
  });
}
