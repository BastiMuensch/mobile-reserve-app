import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { toCanonicalUtcDate } from '../src/lib/dateKey';
import { getSchoolYearForDate } from '../src/lib/schoolYear';

const url = process.env.TEST_DATABASE_URL;
if (!url) test('assignment delivered-work protection', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'assignment-work-protection-test-secret';
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString('base64');
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
  const db = new PrismaClient({ datasourceUrl: url });
  const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
  test.after(async () => { hook.deregister(); await db.$disconnect(); });
  async function invoke(userId: string, path: string, method: string, body: unknown, handler: (req: Request) => Promise<Response>) {
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const request = new Request(`http://localhost${path}`, { method, headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const store = createRequestStoreForAPI(request as never, { pathname: path, search: '' }, [] as never, undefined, undefined, undefined);
    return workAsyncStorage.run({ route: path, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(request)));
  }
  async function fixture(t: test.TestContext) {
    const office = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, password: 'hash', role: 'SCHULAMT' } });
    const school = await db.school.create({ data: { name: 'Recorded Work Test', address: 'Testweg', type: 'GRUNDSCHULE', schulamtId: office.id } });
    const teacherUser = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, password: 'hash', role: 'TEACHER' } });
    const schoolUser = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, password: 'hash', role: 'SCHOOL', schoolId: school.id } });
    const today = toCanonicalUtcDate(new Date());
    const teacher = await db.teacher.create({ data: { name: 'Testreserve', userId: teacherUser.id, stammschuleId: school.id, schoolYear: getSchoolYearForDate(today), qualifications: 'Grundschule', homeLat: 48, homeLng: 11, preferredType: 'BOTH', maxWeeklyHours: 28, status: 'ACTIVE' } });
    t.after(async () => {
      await db.assignment.deleteMany({ where: { teacherId: teacher.id } });
      await db.absence.deleteMany({ where: { teacherId: teacher.id } });
      await db.request.deleteMany({ where: { schoolId: school.id } });
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.emailOutbox.deleteMany({ where: { schulamtId: office.id } });
      await db.user.deleteMany({ where: { id: { in: [schoolUser.id, teacherUser.id] } } });
      await db.school.delete({ where: { id: school.id } });
      await db.user.delete({ where: { id: office.id } });
    });
    async function assignment(offset: number, options: { actualHours?: number; minutes?: number; correction?: 'PENDING' | 'APPROVED' | 'REJECTED'; proposedHours?: number } = {}) {
      const date = new Date(today.getTime() + offset * 86400000);
      const request = await db.request.create({ data: { schoolId: school.id, date, hours: 4, substitutedTeacher: 'Test', qualifications: 'Grundschule', status: 'FILLED' } });
      return db.assignment.create({ data: {
        requestId: request.id, teacherId: teacher.id, date, hours: 4, status: 'ACCEPTED', actualHours: options.actualHours, actualAdditionalMinutes: options.minutes,
        ...(options.correction ? { hourCorrections: { create: { plannedHours: 4, proposedHours: options.proposedHours ?? options.actualHours ?? 4, additionalMinutes: options.minutes ?? 0, reason: 'Testmeldung', status: options.correction, submittedById: schoolUser.id } } } : {}),
      } });
    }
    return { office, teacherUser, schoolUser, assignment };
  }

  test('direct cancellation preserves approved/claimed work and all correction history', async t => {
    const f = await fixture(t);
    const { DELETE } = await import('../src/app/api/assignments/[id]/route');
    const cancel = (id: string) => invoke(f.office.id, `/api/assignments/${id}`, 'DELETE', undefined, request => DELETE(request, { params: Promise.resolve({ id }) }));
    const approved = await f.assignment(-1, { actualHours: 5, correction: 'APPROVED' });
    const pending = await f.assignment(-2, { correction: 'PENDING' });
    const extraTasks = await f.assignment(-3, { actualHours: 0, minutes: 30, correction: 'APPROVED' });
    for (const item of [approved, pending, extraTasks]) {
      const response = await cancel(item.id);
      assert.equal(response.status, 409, await response.clone().text());
      assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: item.id } })).status, 'ACCEPTED');
      assert.equal(await db.assignmentHourCorrection.count({ where: { assignmentId: item.id } }), 1);
    }
    const zero = await f.assignment(-4, { actualHours: 0, correction: 'APPROVED' });
    assert.equal((await cancel(zero.id)).status, 200);
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: zero.id } })).status, 'REJECTED');
    assert.equal(await db.assignmentHourCorrection.count({ where: { assignmentId: zero.id } }), 1, 'zero-hour approval history survives cancellation');
    const declined = await f.assignment(-5, { correction: 'REJECTED' });
    assert.equal((await cancel(declined.id)).status, 200);
    assert.equal(await db.assignmentHourCorrection.count({ where: { assignmentId: declined.id } }), 1, 'rejected correction history also survives');
    const { GET: listRequests } = await import('../src/app/api/requests/route');
    const { GET: readHours } = await import('../src/app/api/requests/[id]/hours/route');
    const { hasReportableAssignmentDay } = await import('../src/lib/assignmentHours');
    for (const user of [f.schoolUser, f.office]) {
      const response = await invoke(user.id, '/api/requests', 'GET', undefined, listRequests);
      assert.equal(response.status, 200);
      const requests = await response.json();
      for (const assignment of [zero, declined]) {
        const request = requests.find((row: { id: string }) => row.id === assignment.requestId);
        assert.ok(request, 'cancelled assignment remains in the request list');
        assert.equal(hasReportableAssignmentDay(request.assignments), true, 'the hour-history entry stays reachable after cancellation');
        assert.equal(request.assignments[0].hourCorrections, undefined, 'the list does not preload private correction text');
        const hours = await invoke(user.id, `/api/requests/${request.id}/hours`, 'GET', undefined,
          incoming => readHours(incoming, { params: Promise.resolve({ id: request.id }) }));
        assert.equal(hours.status, 200);
        assert.equal((await hours.json()).assignments[0].hourCorrections.length, 1);
      }
    }
    const unreported = await f.assignment(-6);
    assert.equal((await cancel(unreported.id)).status, 200);
    assert.equal(await db.assignment.findUnique({ where: { id: unreported.id } }), null, 'unreported legacy cancellation retains its existing behavior');
  });

  test('teacher absence preserves delivered work and pending claims while cancelling unperformed assignments', async t => {
    const f = await fixture(t);
    const { POST } = await import('../src/app/api/teachers/absence/route');
    const approved = await f.assignment(-1, { actualHours: 5, correction: 'APPROVED' });
    const pending = await f.assignment(-2, { correction: 'PENDING' });
    const unperformed = await f.assignment(-3, { actualHours: 0, correction: 'APPROVED' });
    for (const item of [approved, pending, unperformed]) {
      const response = await invoke(f.teacherUser.id, '/api/teachers/absence', 'POST', { date: item.date.toISOString().slice(0, 10), reason: 'Testausfall nach Meldung' }, POST);
      assert.equal(response.status, 200, await response.clone().text());
      const isUnperformed = item.id === unperformed.id;
      assert.equal((await response.json()).count, isUnperformed ? 1 : 0);
      assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: item.id } })).status, isUnperformed ? 'REJECTED' : 'ACCEPTED');
      assert.equal(await db.assignmentHourCorrection.count({ where: { assignmentId: item.id } }), 1);
    }
  });

  test('concurrent office approval cannot be erased by direct cancellation', async t => {
    const f = await fixture(t);
    const { DELETE } = await import('../src/app/api/assignments/[id]/route');
    const { PATCH } = await import('../src/app/api/hour-corrections/[id]/route');
    const assignment = await f.assignment(-1, { correction: 'PENDING', proposedHours: 6 });
    const correction = await db.assignmentHourCorrection.findFirstOrThrow({ where: { assignmentId: assignment.id } });
    const [cancelled, approved] = await Promise.all([
      invoke(f.office.id, `/api/assignments/${assignment.id}`, 'DELETE', undefined, request => DELETE(request, { params: Promise.resolve({ id: assignment.id }) })),
      invoke(f.office.id, `/api/hour-corrections/${correction.id}`, 'PATCH', { decision: 'APPROVED' }, request => PATCH(request, { params: Promise.resolve({ id: correction.id }) })),
    ]);
    assert.equal(cancelled.status, 409);
    assert.equal(approved.status, 200, await approved.clone().text());
    const persisted = await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    assert.equal(persisted.actualHours, 6);
    assert.equal(persisted.status, 'ACCEPTED');
    assert.equal((await db.assignmentHourCorrection.findUniqueOrThrow({ where: { id: correction.id } })).status, 'APPROVED');
  });
}
