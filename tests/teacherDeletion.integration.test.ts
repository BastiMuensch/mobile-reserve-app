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
  test('teacher deletion HTTP integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  // A deletion test must never silently point DATABASE_URL at a development or
  // production database.
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'teacher-deletion-integration-test-secret';
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('teacher deletion enforces tenancy, preserves evidence and handles shared logins atomically', async t => {
    // Next aliases this marker to an empty module for server code. Recreate the
    // alias for the direct Route Handler harness without changing route logic.
    const serverOnly = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
      },
    });
    t.after(() => serverOnly.deregister());
    const { DELETE } = await import('../src/app/api/teachers/[id]/route');
    const { signToken, getSessionUser } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = randomUUID();
    const userIds: string[] = [];
    const schoolIds: string[] = [];
    const teacherIds: string[] = [];

    const invoke = async (userId: string | null, id: string) => {
      const cookie = userId ? `session_token=${await signToken({ id: userId, sessionVersion: 0 })}` : '';
      const request = new Request(`http://localhost/api/teachers/${id}`, { method: 'DELETE', headers: { cookie } });
      const store = createRequestStoreForAPI(request as never, { pathname: `/api/teachers/${id}`, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: '/api/teachers/[id]', forceStatic: false, dynamicShouldError: false } as never, () =>
        workUnitAsyncStorage.run(store, () => DELETE(request, { params: Promise.resolve({ id }) })));
    };
    const sessionFor = async (userId: string) => {
      const cookie = `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`;
      const request = new Request('http://localhost/api/auth/me', { headers: { cookie } });
      const store = createRequestStoreForAPI(request as never, { pathname: '/api/auth/me', search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: '/api/auth/me', forceStatic: false, dynamicShouldError: false } as never, () =>
        workUnitAsyncStorage.run(store, getSessionUser));
    };
    const createUser = async (role: string) => {
      const user = await db.user.create({ data: { email: `${randomUUID()}-${suffix}@test.invalid`, password: 'hash', role } });
      userIds.push(user.id);
      return user;
    };
    const createSchool = async (schulamtId: string) => {
      const school = await db.school.create({ data: { name: `Test ${suffix}`, address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId } });
      schoolIds.push(school.id);
      return school;
    };
    const createTeacher = async (schoolId: string, userId?: string, schoolYear = '2026/2027') => {
      const teacher = await db.teacher.create({ data: {
        name: 'Testreserve', stammschuleId: schoolId, userId, schoolYear, maxWeeklyHours: 28,
        qualifications: 'Grundschule', status: 'ACTIVE', homeLat: 48.1, homeLng: 11.5, preferredType: 'GRUNDSCHULE',
      } });
      teacherIds.push(teacher.id);
      return teacher;
    };
    try {
      const owner = await createUser('SCHULAMT');
      const otherOffice = await createUser('SCHULAMT');
      const teacherUser = await createUser('TEACHER');
      const schoolUser = await createUser('SCHOOL');
      const school = await createSchool(owner.id);
      const teacher = await createTeacher(school.id);

      await t.test('requires an authenticated owning Schulamt and validates IDs', async () => {
        assert.equal((await invoke(null, teacher.id)).status, 401);
        assert.equal((await invoke(teacherUser.id, teacher.id)).status, 403);
        assert.equal((await invoke(schoolUser.id, teacher.id)).status, 403);
        assert.equal((await invoke(otherOffice.id, teacher.id)).status, 404);
        assert.equal((await invoke(owner.id, randomUUID())).status, 404);
        assert.equal((await invoke(owner.id, 'invalid')).status, 400);
        assert.ok(await db.teacher.findUnique({ where: { id: teacher.id } }));
      });

      await t.test('preserves even rejected historical assignments and dependent data', async () => {
        const login = await createUser('TEACHER');
        const historic = await createTeacher(school.id, login.id, '2024/2025');
        const request = await db.request.create({ data: {
          schoolId: school.id, date: new Date('2024-10-01'), hours: 3, substitutedTeacher: 'Test',
          qualifications: 'Grundschule', status: 'CANCELLED', schoolType: 'GRUNDSCHULE',
        } });
        await db.assignment.create({ data: { teacherId: historic.id, requestId: request.id, date: new Date('2024-10-01'), hours: 3, status: 'REJECTED' } });
        await db.absence.create({ data: { teacherId: historic.id, date: new Date('2024-10-02'), type: 'OTHER' } });
        const response = await invoke(owner.id, historic.id);
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /Einsatznachweise/);
        assert.ok(await db.teacher.findUnique({ where: { id: historic.id } }));
        assert.equal(await db.assignment.count({ where: { teacherId: historic.id } }), 1);
        assert.equal(await db.absence.count({ where: { teacherId: historic.id } }), 1);
        assert.ok(await db.user.findUnique({ where: { id: login.id } }));
      });

      await t.test('deletes an unused profile, absences, leave, reporting facts and its sole login', async () => {
        const login = await createUser('TEACHER');
        const unused = await createTeacher(school.id, login.id);
        await db.absence.create({ data: { teacherId: unused.id, date: new Date('2026-10-01'), type: 'OTHER' } });
        await db.leavePeriod.create({ data: { teacherId: unused.id, startDate: new Date('2026-10-02'), reportedBy: 'SCHULAMT' } });
        await db.reserveReportingPeriod.create({ data: { teacherId: unused.id, effectiveFrom: new Date('2026-09-01'), category: 'GS_MS', weeklyHours: 28 } });
        assert.equal((await sessionFor(login.id))?.id, login.id);
        const response = await invoke(owner.id, unused.id);
        assert.equal(response.status, 200, await response.clone().text());
        assert.deepEqual(await response.json(), { success: true });
        assert.equal(await db.teacher.findUnique({ where: { id: unused.id } }), null);
        assert.equal(await db.absence.count({ where: { teacherId: unused.id } }), 0);
        assert.equal(await db.leavePeriod.count({ where: { teacherId: unused.id } }), 0);
        assert.equal(await db.reserveReportingPeriod.count({ where: { teacherId: unused.id } }), 0);
        assert.equal(await db.user.findUnique({ where: { id: login.id } }), null);
        assert.equal(await sessionFor(login.id), null);
        const replacement = await db.user.create({ data: { email: login.email, password: 'hash', role: 'TEACHER' } });
        userIds.push(replacement.id);
      });

      await t.test('keeps a shared login and the profile in another school year', async () => {
        const login = await createUser('TEACHER');
        const old = await createTeacher(school.id, login.id, '2025/2026');
        const current = await createTeacher(school.id, login.id);
        assert.equal((await invoke(owner.id, old.id)).status, 200);
        assert.equal((await db.teacher.findUnique({ where: { id: current.id } }))?.userId, login.id);
        assert.equal((await sessionFor(login.id))?.id, login.id);
      });

      await t.test('blocks an unexpected account role without deleting the profile', async () => {
        const unusual = await createTeacher(school.id, schoolUser.id);
        assert.equal((await invoke(owner.id, unusual.id)).status, 409);
        assert.ok(await db.teacher.findUnique({ where: { id: unusual.id } }));
        assert.ok(await db.user.findUnique({ where: { id: schoolUser.id } }));
      });

      await t.test('deletes a profile without login and safely handles repeated deletion', async () => {
        assert.equal((await invoke(owner.id, teacher.id)).status, 200);
        assert.equal((await invoke(owner.id, teacher.id)).status, 404);
      });
    } finally {
      await db.assignment.deleteMany({ where: { teacherId: { in: teacherIds } } });
      await db.absence.deleteMany({ where: { teacherId: { in: teacherIds } } });
      await db.teacher.deleteMany({ where: { id: { in: teacherIds } } });
      await db.request.deleteMany({ where: { schoolId: { in: schoolIds } } });
      await db.school.deleteMany({ where: { id: { in: schoolIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.$disconnect();
    }
  });
}
