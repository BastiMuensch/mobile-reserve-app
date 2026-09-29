import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import { registerHooks } from 'node:module';
import { OnlyStammschuleError, validateAndCreateAssignments } from '../src/lib/assignService';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('Only Stammschule integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'stammschule-integration-test-secret';
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('restriction persists through API edits and year copy and rejects stale/manual assignments atomically', async (t) => {
    const serverOnly = registerHooks({ resolve: (specifier, context, nextResolve) => nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
    t.after(() => serverOnly.deregister());
    const { POST: createTeacher } = await import('../src/app/api/teachers/route');
    const { PATCH: editTeacher } = await import('../src/app/api/teachers/[id]/route');
    const { POST: copyTeachers } = await import('../src/app/api/teachers/copy/route');
    const { POST: assign } = await import('../src/app/api/assign/route');
    const { POST: approve } = await import('../src/app/api/batch-assign/approve/route');
    const { signToken } = await import('../src/lib/auth');
    const { getCurrentSchoolYear } = await import('../src/lib/schoolYear');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const office = await db.user.create({ data: { email: `stammschule-${Date.now()}@test.local`, password: 'hash', role: 'SCHULAMT' } });
    const token = await signToken({ id: office.id, sessionVersion: office.sessionVersion });
    const invoke = async (handler: (r: Request) => Promise<Response>, path: string, body: unknown, method = 'POST') => {
      const request = new Request(`http://localhost${path}`, { method, headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const store = createRequestStoreForAPI(request as never, { pathname: path, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: path, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(request)));
    };
    try {
      const home = await db.school.create({ data: { name: 'Stammschule', address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: office.id } });
      const other = await db.school.create({ data: { name: 'Andere Schule', address: 'Testweg 2', type: 'GRUNDSCHULE', schulamtId: office.id } });
      const schoolYear = getCurrentSchoolYear();
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 1);
      while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
      const dateKey = date.toISOString().slice(0, 10);
      const form = { qualificationType: 'SPECIALIST', canTeachSports: false, name: 'Testreserve', stammschuleId: home.id, maxWeeklyHours: 28, qualifications: 'Alles', preferredType: 'BOTH', address: 'Testweg 3', postalCode: '80331', homeLat: 48.1, homeLng: 11.5, schoolYear };
      const response = await invoke(createTeacher, '/api/teachers', { ...form, onlyStammschule: true });
      assert.equal(response.status, 201, await response.clone().text());
      const teacher = await response.json();
      assert.equal(teacher.onlyStammschule, true);
      assert.equal(teacher.qualificationType, 'SPECIALIST');
      assert.equal(teacher.canTeachSports, false);
      for (const invalid of [{ qualificationType: undefined }, { canTeachSports: undefined }, { canTeachSports: 'false' }]) {
        assert.equal((await invoke(createTeacher, '/api/teachers', { ...form, ...invalid })).status, 400);
      }
      const patch = (body: unknown) => invoke(r => editTeacher(r, { params: Promise.resolve({ id: teacher.id }) }), `/api/teachers/${teacher.id}`, body, 'PATCH');
      assert.equal((await patch({ ...form, qualificationType: undefined })).status, 400);
      assert.equal((await patch(form)).status, 200);
      assert.equal((await patch({ qualificationType: 'SPECIALIST', canTeachSports: true })).status, 200);
      assert.equal((await patch({ qualificationType: null })).status, 400);
      assert.equal((await patch({ canTeachSports: false })).status, 200);
      assert.equal((await db.teacher.findUniqueOrThrow({ where: { id: teacher.id } })).onlyStammschule, true, 'legacy full edit preserves restriction');
      assert.equal((await patch({ onlyStammschule: 'false' })).status, 400);
      assert.equal((await patch({ onlyStammschule: false })).status, 200);
      assert.equal((await db.teacher.findUniqueOrThrow({ where: { id: teacher.id } })).onlyStammschule, false);
      assert.equal((await patch({ onlyStammschule: true })).status, 200);
      const targetYear = schoolYear.split('/').map(y => Number(y) + 1).join('/');
      const copied = await invoke(copyTeachers, '/api/teachers/copy', { sourceYear: schoolYear, targetYear, teacherIds: [teacher.id], copyLeaveTeacherIds: [] });
      assert.ok(copied.ok, await copied.clone().text());
      assert.equal((await db.teacher.findFirstOrThrow({ where: { stammschuleId: home.id, schoolYear: targetYear } })).onlyStammschule, true);
      const copiedTeacher = await db.teacher.findFirstOrThrow({ where: { stammschuleId: home.id, schoolYear: targetYear } });
      assert.equal(copiedTeacher.qualificationType, 'SPECIALIST');
      assert.equal(copiedTeacher.canTeachSports, false, 'explicit Nein survives status edits and copying');
      const requests: { id: string }[] = [];
      for (const schoolId of [home.id, other.id]) requests.push(await db.request.create({ data: {
        schoolId, date: new Date(`${dateKey}T00:00:00Z`), hours: 2, weeklyHours: 2,
        startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Test', status: 'PENDING', priority: 'UNPLANNED_ABSENCE',
      } }));
      const entries = [{ date: dateKey, hours: 2 }];
      const rejected = await invoke(assign, '/api/assign', { requestId: requests[1].id, teacherId: teacher.id, assignments: entries });
      assert.equal(rejected.status, 409, await rejected.clone().text());
      assert.match((await rejected.json()).error, /Stammschule/);
      const batch = await invoke(approve, '/api/batch-assign/approve', { schoolId: other.id, schoolYear, until: dateKey,
        items: [{ requestId: requests[1].id, segments: [{ teacherId: teacher.id, entries }] }],
      });
      assert.equal(batch.status, 409, await batch.clone().text());
      assert.match((await batch.json()).error, /Stammschule/);
      await assert.rejects(db.$transaction(async tx => {
        await validateAndCreateAssignments(tx, { requestId: requests[0].id, teacherId: teacher.id, entries });
        await validateAndCreateAssignments(tx, { requestId: requests[1].id, teacherId: teacher.id, entries });
      }), OnlyStammschuleError);
      assert.equal(await db.assignment.count({ where: { teacherId: teacher.id } }), 0);
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: requests[0].id } })).status, 'PENDING');
      await db.$transaction(tx => validateAndCreateAssignments(tx, { requestId: requests[0].id, teacherId: teacher.id, entries }));
      assert.equal(await db.assignment.count({ where: { teacherId: teacher.id } }), 1, 'manual assignment to Grundschule succeeds despite informational Mittelschule qualification');
    } finally {
      const schoolWhere = { schulamtId: office.id };
      await db.assignment.deleteMany({ where: { request: { school: schoolWhere } } });
      await db.request.deleteMany({ where: { school: schoolWhere } });
      await db.teacher.deleteMany({ where: { stammschule: schoolWhere } });
      await db.school.deleteMany({ where: schoolWhere });
      await db.user.delete({ where: { id: office.id } });
      await db.$disconnect();
    }
  });
}
