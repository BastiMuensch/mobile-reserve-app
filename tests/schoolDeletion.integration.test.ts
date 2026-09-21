import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { PrismaClient } from '@prisma/client';

// Direct Route Handler calls need the request-scoped storage normally provided
// by Next's server runtime.
if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('school deletion HTTP integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  // A deletion test must never silently point DATABASE_URL at a development or
  // production database.
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'school-deletion-integration-test-secret';
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('school deletion enforces tenancy, preserves referenced schools, and removes an unused login atomically', async t => {
    // Next aliases this marker to an empty module for server code. Recreate the
    // alias for the direct Route Handler harness without changing route logic.
    const serverOnly = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
      },
    });
    t.after(() => serverOnly.deregister());
    const { DELETE } = await import('../src/app/api/schools/route');
    const { signToken, getSessionUser } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = randomUUID();
    const userIds: string[] = [];
    const schoolIds: string[] = [];
    const teacherIds: string[] = [];

    const invoke = async (userId: string | null, body: unknown = undefined, rawBody?: string) => {
      const cookie = userId ? `session_token=${await signToken({ id: userId, sessionVersion: 0 })}` : '';
      const request = new Request('http://localhost/api/schools', {
        method: 'DELETE', headers: { cookie, 'content-type': 'application/json' },
        ...(rawBody !== undefined ? { body: rawBody } : body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const store = createRequestStoreForAPI(request as never, { pathname: '/api/schools', search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: '/api/schools', forceStatic: false, dynamicShouldError: false } as never, () =>
        workUnitAsyncStorage.run(store, () => DELETE(request)));
    };
    const sessionFor = async (userId: string) => {
      const cookie = `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`;
      const request = new Request('http://localhost/api/auth/me', { headers: { cookie } });
      const store = createRequestStoreForAPI(request as never, { pathname: '/api/auth/me', search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: '/api/auth/me', forceStatic: false, dynamicShouldError: false } as never, () =>
        workUnitAsyncStorage.run(store, getSessionUser));
    };
    const createUser = async (role: string, emailPrefix: string) => {
      const user = await db.user.create({ data: { email: `${emailPrefix}-${suffix}@test.invalid`, password: 'hash', role } });
      userIds.push(user.id);
      return user;
    };
    const createSchool = async (schulamtId: string, label: string) => {
      const school = await db.school.create({
        data: { name: `${label} ${suffix}`, address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId },
      });
      schoolIds.push(school.id);
      return school;
    };
    const attachSchoolLogin = async (schoolId: string, role = 'SCHOOL', emailPrefix = 'school-login') => {
      const user = await createUser(role, emailPrefix);
      await db.user.update({ where: { id: user.id }, data: { schoolId } });
      return user;
    };
    const createTeacher = async (schoolId: string, userId?: string) => {
      const teacher = await db.teacher.create({
        data: {
          name: 'Löschsperre', stammschuleId: schoolId, userId, maxWeeklyHours: 28,
          qualifications: 'Grundschule', status: 'ACTIVE', homeLat: 48.1, homeLng: 11.5, preferredType: 'GRUNDSCHULE',
        },
      });
      teacherIds.push(teacher.id);
      return teacher;
    };

    try {
      const owner = await createUser('SCHULAMT', 'owner');
      const otherOffice = await createUser('SCHULAMT', 'other-office');
      const teacherUser = await createUser('TEACHER', 'teacher');
      const ownedSchool = await createSchool(owner.id, 'Owned');

      await t.test('requires an authenticated Schulamt and only permits its own school', async () => {
        assert.equal((await invoke(null, { schoolId: ownedSchool.id })).status, 401);
        assert.equal((await invoke(teacherUser.id, { schoolId: ownedSchool.id })).status, 403);
        assert.equal((await invoke(otherOffice.id, { schoolId: ownedSchool.id })).status, 404);
        assert.ok(await db.school.findUnique({ where: { id: ownedSchool.id } }), 'a foreign authority must not change the school');
      });

      await t.test('rejects malformed and non-UUID payloads before any deletion', async () => {
        for (const body of [undefined, {}, { schoolId: 'not-a-uuid' }, { schoolId: 42 }]) {
          assert.equal((await invoke(owner.id, body)).status, 400);
        }
        assert.equal((await invoke(owner.id, undefined, '{')).status, 400);
        assert.ok(await db.school.findUnique({ where: { id: ownedSchool.id } }));
      });

      await t.test('keeps both school and account when demands from any school year exist', async () => {
        const school = await createSchool(owner.id, 'Historical demand');
        const login = await attachSchoolLogin(school.id, 'SCHOOL', 'demand-login');
        await db.request.create({
          data: {
            schoolId: school.id, date: new Date('2024-01-15T00:00:00.000Z'), hours: 3,
            substitutedTeacher: 'Historische Lehrkraft', qualifications: 'Grundschule', status: 'CANCELLED', schoolType: 'GRUNDSCHULE',
          },
        });
        assert.equal((await invoke(owner.id, { schoolId: school.id })).status, 409);
        assert.ok(await db.school.findUnique({ where: { id: school.id } }));
        assert.ok(await db.user.findUnique({ where: { id: login.id } }), 'a failed deletion must not orphan the school account');
      });

      await t.test('keeps both school and account when it has teachers', async () => {
        const school = await createSchool(owner.id, 'Teacher');
        const login = await attachSchoolLogin(school.id, 'SCHOOL', 'teacher-login');
        await createTeacher(school.id);
        assert.equal((await invoke(owner.id, { schoolId: school.id })).status, 409);
        assert.ok(await db.school.findUnique({ where: { id: school.id } }));
        assert.ok(await db.user.findUnique({ where: { id: login.id } }));
      });

      await t.test('blocks unexpected school-account roles and accounts used by teachers elsewhere', async () => {
        const strangeRoleSchool = await createSchool(owner.id, 'Unexpected role');
        const strangeLogin = await attachSchoolLogin(strangeRoleSchool.id, 'TEACHER', 'unexpected-role');
        assert.equal((await invoke(owner.id, { schoolId: strangeRoleSchool.id })).status, 409);
        assert.ok(await db.school.findUnique({ where: { id: strangeRoleSchool.id } }));
        assert.ok(await db.user.findUnique({ where: { id: strangeLogin.id } }));

        const sharedAccountSchool = await createSchool(owner.id, 'Shared account');
        const sharedLogin = await attachSchoolLogin(sharedAccountSchool.id, 'SCHOOL', 'shared-login');
        const otherSchool = await createSchool(owner.id, 'Teacher home');
        await createTeacher(otherSchool.id, sharedLogin.id);
        assert.equal((await invoke(owner.id, { schoolId: sharedAccountSchool.id })).status, 409);
        assert.ok(await db.school.findUnique({ where: { id: sharedAccountSchool.id } }));
        assert.ok(await db.user.findUnique({ where: { id: sharedLogin.id } }));
      });

      await t.test('deletes an unused school and its SCHOOL login, invalidates its session, and frees the email', async () => {
        const school = await createSchool(owner.id, 'Disposable');
        const email = `reusable-login-${suffix}@test.invalid`;
        const login = await db.user.create({ data: { email, password: 'hash', role: 'SCHOOL', schoolId: school.id } });
        userIds.push(login.id);
        assert.equal((await sessionFor(login.id))?.id, login.id, 'the fixture login must start with a valid session');

        const response = await invoke(owner.id, { schoolId: school.id });
        assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
        assert.deepEqual(await response.json(), { success: true });
        assert.equal(await db.school.findUnique({ where: { id: school.id } }), null);
        assert.equal(await db.user.findUnique({ where: { id: login.id } }), null);
        assert.equal(await sessionFor(login.id), null, 'a token for the removed login must no longer authenticate');

        const replacement = await db.user.create({ data: { email, password: 'hash', role: 'SCHOOL' } });
        userIds.push(replacement.id);
      });

      await t.test('also deletes a school that has no login account', async () => {
        const school = await createSchool(owner.id, 'No login');
        assert.equal((await invoke(owner.id, { schoolId: school.id })).status, 200);
        assert.equal(await db.school.findUnique({ where: { id: school.id } }), null);
      });
    } finally {
      // Remove dependent rows first so failed-deletion fixtures can be cleaned
      // up without weakening the assertions above.
      if (schoolIds.length) await db.request.deleteMany({ where: { schoolId: { in: schoolIds } } });
      if (teacherIds.length) await db.teacher.deleteMany({ where: { id: { in: teacherIds } } });
      // A Schulamt is referenced by its schools, while a school login points
      // in the opposite direction. Drop the latter first, then detach the
      // tenant reference before removing the remaining fixtures.
      if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds }, schoolsManaged: { none: {} } } });
      if (schoolIds.length) await db.school.updateMany({ where: { id: { in: schoolIds } }, data: { schulamtId: null } });
      if (schoolIds.length) await db.school.deleteMany({ where: { id: { in: schoolIds } } });
      if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.$disconnect();
    }
  });
}
