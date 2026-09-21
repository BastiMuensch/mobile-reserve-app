import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { setTimeout as delay } from 'node:timers/promises';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('school password integration (skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => assert.ok(true));
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'school-password-integration-test-secret';
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('school accounts must replace temporary passwords and a password change renews only the current session', async () => {
    const { POST: login } = await import('../src/app/api/auth/login/route');
    const { POST: changePassword } = await import('../src/app/api/auth/change-password/route');
    const { getSessionUser, getFullSessionUser } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `school-password-${suffix}@test.local`;
    const oldPassword = 'temporary school password';
    const newPassword = 'replacement school password';
    let userId = '';

    const invoke = async <T>(pathname: string, request: Request, handler: () => Promise<T>, onUpdateCookies?: (values: string[]) => void) => {
      const store = createRequestStoreForAPI(request as never, { pathname, search: new URL(request.url).search }, [] as never, onUpdateCookies, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, handler));
    };
    const cookieToken = (cookies: string[]) => /^session_token=([^;]+)/.exec(cookies.find(value => value.startsWith('session_token=')) || '')?.[1];
    const loginRequest = (password: string) => new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const changeRequest = (token: string, currentPassword: string, nextPassword: string) => new Request('http://localhost/api/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `session_token=${token}` }, body: JSON.stringify({ currentPassword, newPassword: nextPassword }) });

    try {
      const school = await prisma.school.create({ data: { name: `Testschule ${suffix}`, address: 'Testweg 1', type: 'GRUNDSCHULE' } });
      const user = await prisma.user.create({ data: { email, password: await bcrypt.hash(oldPassword, 12), role: 'SCHOOL', schoolId: school.id, mustChangePassword: true, sessionVersion: 4 } });
      userId = user.id;

      let loginCookies: string[] = [];
      const validLoginRequest = loginRequest(oldPassword);
      const validLogin = await invoke('/api/auth/login', validLoginRequest, () => login(validLoginRequest), values => { loginCookies = values; });
      assert.equal(validLogin.status, 200);
      assert.equal((await validLogin.json()).user.mustChangePassword, true);
      const oldToken = cookieToken(loginCookies);
      assert.ok(oldToken);
      const oldCookieRequest = new Request('http://localhost/api/auth/me', { headers: { cookie: `session_token=${oldToken}` } });
      assert.equal(await invoke('/api/auth/me', oldCookieRequest, getSessionUser), null, 'normal APIs are blocked until the password is changed');
      assert.equal((await invoke('/api/auth/me', oldCookieRequest, getFullSessionUser))?.id, userId, '/me may hydrate the restricted account');

      const wrongChangeRequest = changeRequest(oldToken, 'incorrect current password', newPassword);
      const wrongChange = await invoke('/api/auth/change-password', wrongChangeRequest, () => changePassword(wrongChangeRequest));
      assert.equal(wrongChange.status, 401);
      const byteOverflow = changeRequest(oldToken, oldPassword, 'ä'.repeat(37));
      const byteOverflowResult = await invoke('/api/auth/change-password', byteOverflow, () => changePassword(byteOverflow));
      assert.equal(byteOverflowResult.status, 400);

      let changedCookies: string[] = [];
      const validChangeRequest = changeRequest(oldToken, oldPassword, newPassword);
      const changed = await invoke('/api/auth/change-password', validChangeRequest, () => changePassword(validChangeRequest), values => { changedCookies = values; });
      assert.equal(changed.status, 200);
      assert.deepEqual(await changed.json(), { success: true, mustChangePassword: false });
      const newToken = cookieToken(changedCookies);
      assert.ok(newToken);
      assert.equal(await invoke('/api/auth/me', oldCookieRequest, getSessionUser), null, 'old session is invalidated');
      const renewedRequest = new Request('http://localhost/api/auth/me', { headers: { cookie: `session_token=${newToken}` } });
      assert.equal((await invoke('/api/auth/me', renewedRequest, getSessionUser))?.id, userId);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).mustChangePassword, false);
      const oldLoginRequest = loginRequest(oldPassword);
      assert.equal((await invoke('/api/auth/login', oldLoginRequest, () => login(oldLoginRequest))).status, 401);
    } finally {
      if (userId) {
        const current = await prisma.user.findUnique({ where: { id: userId }, select: { schoolId: true } });
        await prisma.user.deleteMany({ where: { id: userId } });
        if (current?.schoolId) await prisma.school.deleteMany({ where: { id: current.schoolId } });
      }
      await prisma.$disconnect();
    }
  });

  test('concurrent reset and school password change commit exactly one winner', async () => {
    const { POST: login } = await import('../src/app/api/auth/login/route');
    const { POST: changePassword } = await import('../src/app/api/auth/change-password/route');
    const { POST: confirmReset } = await import('../src/app/api/auth/reset/confirm/route');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `school-race-${suffix}@test.local`, oldPassword = 'temporary school password', changedPassword = 'changed school password', resetPassword = 'reset school password';
    let userId = '';
    const invoke = async <T>(pathname: string, request: Request, handler: () => Promise<T>, onUpdateCookies?: (values: string[]) => void) => {
      const store = createRequestStoreForAPI(request as never, { pathname, search: new URL(request.url).search }, [] as never, onUpdateCookies, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, handler));
    };
    try {
      const school = await prisma.school.create({ data: { name: `Race ${suffix}`, address: 'Testweg 1', type: 'GRUNDSCHULE' } });
      const user = await prisma.user.create({ data: { email, password: await bcrypt.hash(oldPassword, 12), role: 'SCHOOL', schoolId: school.id, mustChangePassword: true } });
      userId = user.id;
      const rawToken = crypto.randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({ data: { userId, tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'), expiresAt: new Date(Date.now() + 60_000) } });
      let cookies: string[] = [];
      const request = new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: oldPassword }) });
      const loginResponse = await invoke('/api/auth/login', request, () => login(request), values => { cookies = values; });
      assert.equal(loginResponse.status, 200);
      const token = /^session_token=([^;]+)/.exec(cookies.find(value => value.startsWith('session_token=')) || '')?.[1];
      assert.ok(token);
      const changeRequest = new Request('http://localhost/api/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `session_token=${token}` }, body: JSON.stringify({ currentPassword: oldPassword, newPassword: changedPassword }) });
      const resetRequest = new Request('http://localhost/api/auth/reset/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: rawToken, password: resetPassword }) });
      const [change, reset] = await Promise.all([
        invoke('/api/auth/change-password', changeRequest, () => changePassword(changeRequest)),
        invoke('/api/auth/reset/confirm', resetRequest, () => confirmReset(resetRequest)),
      ]);
      assert.ok([200, 409].includes(change.status), `change returned ${change.status}: ${await change.text()}`);
      assert.ok([200, 400].includes(reset.status), `reset returned ${reset.status}: ${await reset.text()}`);
      assert.equal(Number(change.status === 200) + Number(reset.status === 200), 1, 'exactly one credential update must win');
      const finalUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      assert.equal(finalUser.mustChangePassword, false);
      assert.equal(finalUser.sessionVersion, 1);
      assert.ok(await bcrypt.compare(change.status === 200 ? changedPassword : resetPassword, finalUser.password));
      assert.equal(await prisma.passwordResetToken.count({ where: { userId, usedAt: null } }), 0);
    } finally {
      if (userId) {
        const current = await prisma.user.findUnique({ where: { id: userId }, select: { schoolId: true } });
        await prisma.user.deleteMany({ where: { id: userId } });
        if (current?.schoolId) await prisma.school.deleteMany({ where: { id: current.schoolId } });
      }
      await prisma.$disconnect();
    }
  });

  for (const invalidateWhileWaiting of [false, true]) {
    test(`reset waits for the account before locking its token${invalidateWhileWaiting ? ' and rolls back if the token is revoked while waiting' : ''}`, async () => {
      const { POST: confirmReset } = await import('../src/app/api/auth/reset/confirm/route');
      const originalHash = await bcrypt.hash('initial school password', 12);
      const user = await prisma.user.create({ data: {
        email: `reset-lock-${crypto.randomUUID()}@test.local`, password: originalHash,
        role: 'SCHOOL', isActive: false, mustChangePassword: true, sessionVersion: 7,
      } });
      const rawToken = crypto.randomBytes(32).toString('base64url');
      const resetToken = await prisma.passwordResetToken.create({ data: {
        userId: user.id, tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      } });
      let releaseAccount!: () => void;
      const accountGate = new Promise<void>(resolve => { releaseAccount = resolve; });
      let announceLock!: (pid: number) => void;
      let rejectLock!: (error: unknown) => void;
      const locked = new Promise<number>((resolve, reject) => { announceLock = resolve; rejectLock = reject; });
      const heldAccount = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        announceLock(backend.pid);
        await accountGate;
      }, { timeout: 15_000 });
      void heldAccount.catch(rejectLock);
      let pendingReset: Promise<Response> | undefined;
      try {
        const blockerPid = await locked;
        pendingReset = confirmReset(new Request('http://localhost/api/auth/reset/confirm', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: rawToken, password: 'replacement reset password' }),
        }));
        // Observe the real PostgreSQL wait, rather than relying on a sleep to
        // guess which bcrypt/transaction operation the other request reached.
        const deadline = Date.now() + 10_000;
        let waiting = false;
        while (Date.now() < deadline) {
          const blocked = await prisma.$queryRaw<{ pid: number }[]>`
            SELECT pid FROM pg_stat_activity
            WHERE datname = current_database() AND ${blockerPid} = ANY(pg_blocking_pids(pid))`;
          if (blocked.length) { waiting = true; break; }
          await delay(10);
        }
        assert.ok(waiting, 'reset must be waiting for this account row');
        // The old implementation already held this token while waiting for the
        // account: NOWAIT fails deterministically with PostgreSQL 55P03 then.
        await prisma.$queryRaw`SELECT "id" FROM "PasswordResetToken" WHERE "id" = ${resetToken.id} FOR UPDATE NOWAIT`;
        if (invalidateWhileWaiting) {
          await prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } });
        }
        releaseAccount();
        await heldAccount;
        const response = await pendingReset;
        assert.equal(response.status, invalidateWhileWaiting ? 400 : 200, await response.text());
        const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        if (invalidateWhileWaiting) {
          assert.equal(after.password, originalHash);
          assert.equal(after.sessionVersion, 7);
          assert.equal(after.isActive, false);
          assert.equal(after.mustChangePassword, true);
        } else {
          assert.ok(await bcrypt.compare('replacement reset password', after.password));
          assert.equal(after.sessionVersion, 8);
          assert.equal(after.isActive, true);
          assert.equal(after.mustChangePassword, false);
        }
      } finally {
        releaseAccount();
        await Promise.allSettled([heldAccount, ...(pendingReset ? [pendingReset] : [])]);
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
      }
    });
  }
}
