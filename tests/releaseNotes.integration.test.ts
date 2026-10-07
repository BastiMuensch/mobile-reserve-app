import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import packageJson from '../package.json';
import { releaseSeenKey, getReleaseNotice } from '../src/lib/releaseNotes';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  test('installed release notice integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'release-notes-integration-test-secret';
  process.env.APP_VERSION = packageJson.version;
  process.env.UPDATE_CHECK_ENABLED = 'false';
  const db = new PrismaClient({ datasources: { db: { url } } });

  test('installed notices persist per account and version with role and request validation', async () => {
    const { GET, POST } = await import('../src/app/api/release-notes/route');
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const users: string[] = [];
    const keys: string[] = [];
    const user = async (role: string, extra = {}) => {
      const result = await db.user.create({ data: { email: `${randomUUID()}@release.test`, password: 'test', role, ...extra } });
      users.push(result.id);
      return result;
    };
    const invoke = async (userId: string | null, method = 'GET', body?: unknown, origin = 'http://localhost') => {
      const pathname = '/api/release-notes';
      const request = new Request(`http://localhost${pathname}`, {
        method, headers: {
          ...(userId ? { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}` } : {}),
          'content-type': 'application/json', origin,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never,
        () => workUnitAsyncStorage.run(store, () => method === 'GET' ? GET() : POST(request)));
    };
    try {
      const office = await user('SCHULAMT');
      const school = await user('SCHOOL');
      const otherSchool = await user('SCHOOL');
      const teacher = await user('TEACHER');
      const temporary = await user('SCHOOL', { mustChangePassword: true });
      const inactive = await user('SCHULAMT', { isActive: false });
      const version = packageJson.version;
      const schoolNotice = getReleaseNotice(version, 'SCHOOL');
      const key = releaseSeenKey(office.id, version);
      keys.push(key, releaseSeenKey(school.id, version));
      assert.equal((await invoke(null)).status, 401);
      assert.equal((await invoke(teacher.id)).status, 403);
      assert.equal((await invoke(temporary.id)).status, 401);
      assert.equal((await invoke(inactive.id)).status, 401);
      assert.equal((await invoke(teacher.id, 'POST', { version })).status, 403);
      const first = await invoke(office.id);
      assert.equal(first.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual((await first.json()).notice, getReleaseNotice(version, 'SCHULAMT'));
      assert.deepEqual((await (await invoke(school.id)).json()).notice, schoolNotice);
      assert.equal(await db.systemSetting.findUnique({ where: { id: key } }), null, 'Reading does not acknowledge unseen information.');

      assert.equal((await invoke(office.id, 'POST', { version }, 'https://foreign.example')).status, 403);
      for (const body of [{}, { version: 12 }, { version, userId: otherSchool.id }]) {
        assert.equal((await invoke(office.id, 'POST', body)).status, 400);
      }
      assert.equal((await invoke(office.id, 'POST', { version: '9.9.9' })).status, 409);
      assert.equal(await db.systemSetting.findUnique({ where: { id: key } }), null);
      // Dismissing the available-update banner must not hide installed changes.
      keys.push(`update-dismissed:${office.id}`);
      await db.systemSetting.create({ data: { id: keys.at(-1)!, value: version } });
      assert.ok((await (await invoke(office.id)).json()).notice);
      assert.equal((await invoke(office.id, 'POST', { version })).status, 200);
      assert.equal((await invoke(office.id, 'POST', { version })).status, 200, 'Repeated acknowledgements are harmless.');
      assert.ok(await db.systemSetting.findUnique({ where: { id: key } }));
      assert.equal((await (await invoke(office.id)).json()).notice, null, 'A fresh request/session sees the saved acknowledgement.');
      assert.deepEqual((await (await invoke(school.id)).json()).notice, schoolNotice, 'Other accounts remain unaffected.');
      assert.equal((await invoke(school.id, 'POST', { version })).status, schoolNotice ? 200 : 409);
      assert.equal((await (await invoke(school.id)).json()).notice, null);
      assert.deepEqual((await (await invoke(otherSchool.id)).json()).notice, schoolNotice);

      process.env.APP_VERSION = `${version}+integration.2`;
      const nextVersion = process.env.APP_VERSION;
      keys.push(releaseSeenKey(office.id, nextVersion));
      assert.equal((await (await invoke(office.id)).json()).notice.version, nextVersion);
      assert.equal((await invoke(office.id, 'POST', { version })).status, 409, 'An old tab cannot acknowledge a newly installed version.');
      assert.equal((await invoke(office.id, 'POST', { version: nextVersion })).status, 200);
      process.env.APP_VERSION = version;
      assert.equal((await (await invoke(office.id)).json()).notice, null, 'Rollback preserves prior acknowledgements.');
    } finally {
      await db.systemSetting.deleteMany({ where: { id: { in: keys } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
      const { prisma } = await import('../src/lib/prisma'); await prisma.$disconnect();
    }
  });
}
