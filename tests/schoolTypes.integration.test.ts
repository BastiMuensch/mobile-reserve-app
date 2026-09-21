import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { PrismaClient } from '@prisma/client';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('school types HTTP integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'school-types-integration-test-secret';
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('combined schools persist through creation, updates and new requests with tenant and role boundaries', async t => {
    // Next aliases this marker to its empty implementation for server code.
    // Direct route tests need the same alias without replacing the route logic.
    const serverOnly = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
      },
    });
    t.after(() => serverOnly.deregister());
    const { POST, PATCH, GET } = await import('../src/app/api/schools/route');
    const { POST: createRequest } = await import('../src/app/api/requests/route');
    const { signToken } = await import('../src/lib/auth');
    const { toLocalDateInputValue } = await import('../src/lib/dateKey');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = randomUUID();
    const users: string[] = [];
    let schoolId = '';
    const invoke = async (handler: (request: Request) => Promise<Response>, userId: string | null, method: string, body?: unknown, pathname = '/api/schools') => {
      const cookie = userId ? `session_token=${await signToken({ id: userId, sessionVersion: 0 })}` : '';
      const request = new Request(`http://localhost${pathname}`, {
        method, headers: { cookie, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () =>
        workUnitAsyncStorage.run(store, () => handler(request)));
    };

    try {
      for (const role of ['SCHULAMT', 'SCHULAMT', 'TEACHER']) {
        users.push((await db.user.create({ data: { email: `${users.length}-${suffix}@test.invalid`, password: 'hash', role } })).id);
      }
      const [office, otherOffice, teacher] = users;
      await db.schulamtProfile.create({ data: { userId: office, mailProvider: 'NONE' } });
      const schoolData = {
        name: 'Kombinierte Testschule', address: 'Testweg 1', type: 'GS_MS',
        email: `school-${suffix}@test.invalid`, password: 'test-school-password',
        latitude: 48.1, longitude: 11.5,
      };

      await t.test('creation accepts GS_MS and validates types before writing', async () => {
        assert.equal((await invoke(POST, null, 'POST', schoolData)).status, 401);
        assert.equal((await invoke(POST, teacher, 'POST', schoolData)).status, 401);
        assert.equal((await invoke(POST, office, 'POST', { ...schoolData, type: 'BOTH' })).status, 400);
        const response = await invoke(POST, office, 'POST', schoolData);
        assert.equal(response.status, 201);
        const created = await response.json();
        schoolId = created.id;
        users.push(created.user.id);
        assert.equal(created.type, 'GS_MS');
        assert.equal((await db.school.findUniqueOrThrow({ where: { id: schoolId } })).type, 'GS_MS');
        const listing = await (await invoke(GET, office, 'GET')).json();
        assert.equal(listing.find((school: { id: string }) => school.id === schoolId).type, 'GS_MS');
      });
      assert.ok(schoolId, 'school creation must succeed before testing updates');
      const schoolUser = users[3];
      const update = { action: 'updateType', schoolId, type: 'GRUNDSCHULE' };

      await t.test('only the owning school authority can change to supported types', async () => {
        for (const user of [null, teacher, schoolUser]) {
          assert.equal((await invoke(PATCH, user, 'PATCH', update)).status, 401);
        }
        assert.equal((await invoke(PATCH, otherOffice, 'PATCH', update)).status, 404);
        for (const body of [{ ...update, type: 'BOTH' }, { ...update, schoolId: 'invalid' }, { action: 'updateType', schoolId }]) {
          assert.equal((await invoke(PATCH, office, 'PATCH', body)).status, 400);
        }
        assert.equal((await db.school.findUniqueOrThrow({ where: { id: schoolId } })).type, 'GS_MS');
        for (const type of ['GRUNDSCHULE', 'MITTELSCHULE', 'GS_MS']) {
          assert.equal((await invoke(PATCH, office, 'PATCH', { ...update, type })).status, 200);
          assert.equal((await db.school.findUniqueOrThrow({ where: { id: schoolId } })).type, type);
        }
      });

      await t.test('new demand inherits GS_MS; later school changes preserve historical demand', async () => {
        const response = await invoke(createRequest, schoolUser, 'POST', {
          schoolId, date: toLocalDateInputValue(), startHour: 1, hours: 2,
          substitutedTeacher: 'Testperson', qualifications: 'Grundschule', comments: 'Beginn um 8 Uhr.',
          idempotencyKey: randomUUID(), schoolType: 'MITTELSCHULE',
        }, '/api/requests');
        assert.equal(response.status, 201, response.status === 201 ? '' : await response.text());
        const demand = await response.json();
        assert.equal(demand.schoolType, 'GS_MS', 'client-supplied school type must not override the school');
        assert.equal((await invoke(PATCH, office, 'PATCH', update)).status, 200);
        assert.equal((await db.request.findUniqueOrThrow({ where: { id: demand.id } })).schoolType, 'GS_MS');
      });
    } finally {
      if (schoolId) await db.request.deleteMany({ where: { schoolId } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      if (schoolId) await db.school.deleteMany({ where: { id: schoolId } });
      await db.$disconnect();
    }
  });
}
