import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { toCanonicalUtcDate } from '../src/lib/dateKey';
import { getSchoolYearForDate } from '../src/lib/schoolYear';
import { getOpenRequestDays } from '../src/lib/requestDays';

const url = process.env.TEST_DATABASE_URL;
if (!url) test('request lifecycle and hours integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'request-lifecycle-hours-test-secret';
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 24).toString('base64');
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
  const db = new PrismaClient({ datasourceUrl: url });
  const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
  test.after(async () => { hook.deregister(); await db.$disconnect(); });
  async function invoke(userId: string, path: string, method: string, body: unknown, handler: (req: Request) => Promise<Response | undefined>) {
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const request = new Request(`http://localhost${path}`, { method, headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
    const store = createRequestStoreForAPI(request as never, { pathname: path, search: '' }, [] as never, undefined, undefined, undefined);
    const response = await workAsyncStorage.run({ route: path, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(request)));
    assert.ok(response); return response;
  }
  async function fixture(t: test.TestContext) {
    const office = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, password: 'hash', role: 'SCHULAMT' } });
    const otherOffice = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, password: 'hash', role: 'SCHULAMT' } });
    const school = await db.school.create({ data: { name: 'Lifecycle Testschule', address: 'Testweg', type: 'GRUNDSCHULE', schulamtId: office.id } });
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, password: 'hash', role: 'SCHOOL', schoolId: school.id } });
    const today = toCanonicalUtcDate(new Date());
    const day = (offset: number) => new Date(today.getTime() + offset * 86400000);
    const teacher = await db.teacher.create({ data: { name: 'Testreserve', stammschuleId: school.id, schoolYear: getSchoolYearForDate(today), qualifications: '', homeLat: 48, homeLng: 11, preferredType: 'BOTH', maxWeeklyHours: 28, status: 'ACTIVE' } });
    t.after(async () => {
      await db.absence.deleteMany({ where: { teacherId: teacher.id } });
      await db.assignment.deleteMany({ where: { teacherId: teacher.id } });
      await db.request.deleteMany({ where: { schoolId: school.id } });
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.emailOutbox.deleteMany({ where: { schulamtId: office.id } });
      await db.user.delete({ where: { id: user.id } });
      await db.school.delete({ where: { id: school.id } });
      await db.user.deleteMany({ where: { id: { in: [office.id, otherOffice.id] } } });
    });
    const makeRequest = (start = -2) => db.request.create({ data: { schoolId: school.id, date: day(start), endDate: day(5), hours: 4, substitutedTeacher: 'Test', qualifications: '', status: 'FILLED' } });
    return { office, otherOffice, school, user, teacher, day, makeRequest };
  }
  test('school ends fixed assigned demand, preserves past work and cancels remaining assignments with an audit', async t => {
    const f = await fixture(t);
    const { PATCH } = await import('../src/app/api/requests/[id]/end/route');
    const req = await f.makeRequest();
    const assignments = await Promise.all([-1, 0, 1].map(offset => db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(offset), hours: 4, status: 'ACCEPTED' } })));
    const call = (id: string, body: unknown) => invoke(id, `/api/requests/${req.id}/end`, 'PATCH', body, request => PATCH(request, { params: Promise.resolve({ id: req.id }) }));
    assert.equal((await call(f.otherOffice.id, { action: 'CANCEL' })).status, 403);
    const ended = await call(f.user.id, { lastDay: f.day(0).toISOString().slice(0, 10) });
    assert.equal(ended.status, 200, await ended.clone().text());
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignments[2].id } })).status, 'REJECTED');
    const cancelled = await call(f.user.id, { action: 'CANCEL' });
    assert.equal(cancelled.status, 200, await cancelled.clone().text());
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignments[0].id } })).status, 'ACCEPTED');
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignments[1].id } })).status, 'REJECTED');
    assert.equal((await db.request.findUniqueOrThrow({ where: { id: req.id } })).status, 'ENDED');
    assert.equal(await db.requestLifecycleEvent.count({ where: { requestId: req.id } }), 2);
    const future = await f.makeRequest(2);
    const cancelledFuture = await invoke(f.user.id, `/api/requests/${future.id}/end`, 'PATCH', { action: 'CANCEL' }, request => PATCH(request, { params: Promise.resolve({ id: future.id }) }));
    assert.equal(cancelledFuture.status, 200);
    assert.equal((await db.request.findUniqueOrThrow({ where: { id: future.id } })).status, 'CANCELLED');
  });
  test('a same-day cancellation can keep today so the school can still report the delivered hours', async t => {
    const f = await fixture(t);
    const { PATCH } = await import('../src/app/api/requests/[id]/end/route');
    const { POST } = await import('../src/app/api/assignments/[id]/hours/route');
    const req = await f.makeRequest(0);
    const [todayAssignment, tomorrow] = await Promise.all([0, 1].map(offset => db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(offset), hours: 4, status: 'ACCEPTED' } })));
    const kept = await invoke(f.user.id, `/api/requests/${req.id}/end`, 'PATCH', { action: 'CANCEL', keepToday: true }, request => PATCH(request, { params: Promise.resolve({ id: req.id }) }));
    assert.equal(kept.status, 200, await kept.clone().text());
    const stored = await db.request.findUniqueOrThrow({ where: { id: req.id } });
    assert.equal(stored.status, 'ENDED', 'kept day turns the cancellation into an early end');
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: todayAssignment.id } })).status, 'ACCEPTED');
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: tomorrow.id } })).status, 'REJECTED');
    const reported = await invoke(f.user.id, `/api/assignments/${todayAssignment.id}/hours`, 'POST', { proposedHours: 2, reason: 'Reserve war bis zur Absage im Einsatz' }, request => POST(request, { params: Promise.resolve({ id: todayAssignment.id }) }));
    assert.equal(reported.status, 201, await reported.clone().text());
    // Without keepToday a same-day request is cancelled completely.
    const other = await f.makeRequest(0);
    const otherToday = await db.assignment.create({ data: { requestId: other.id, teacherId: f.teacher.id, date: f.day(0), hours: 4, status: 'PENDING' } }).catch(() => null);
    const dropped = await invoke(f.user.id, `/api/requests/${other.id}/end`, 'PATCH', { action: 'CANCEL' }, request => PATCH(request, { params: Promise.resolve({ id: other.id }) }));
    assert.equal(dropped.status, 200);
    assert.equal((await db.request.findUniqueOrThrow({ where: { id: other.id } })).status, 'CANCELLED');
    if (otherToday) assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: otherToday.id } })).status, 'REJECTED');
  });
  test('hour corrections are tenant-scoped, single pending, explicitly reviewed and preserve planned hours', async t => {
    const f = await fixture(t);
    const { POST } = await import('../src/app/api/assignments/[id]/hours/route');
    const { PATCH } = await import('../src/app/api/hour-corrections/[id]/route');
    const { GET } = await import('../src/app/api/requests/[id]/hours/route');
    const req = await f.makeRequest();
    const assignment = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(0), hours: 4, status: 'ACCEPTED' } });
    const post = () => invoke(f.user.id, `/api/assignments/${assignment.id}/hours`, 'POST', { proposedHours: 5, additionalMinutes: 30, additionalTasks: 'Material vorbereitet', reason: 'Zusätzliche Unterrichtsstunde' }, request => POST(request, { params: Promise.resolve({ id: assignment.id }) }));
    const simultaneous = await Promise.all([post(), post()]);
    assert.deepEqual(simultaneous.map(response => response.status).sort(), [201, 409], 'only one concurrent correction may remain pending');
    const response = simultaneous.find(response => response.status === 201)!;
    const correction = await response.json();
    assert.equal((await post()).status, 409);
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).actualHours, null);
    const review = (actor: string, id: string, decision: string, reviewNote = '') => invoke(actor, `/api/hour-corrections/${id}`, 'PATCH', { decision, reviewNote }, request => PATCH(request, { params: Promise.resolve({ id }) }));
    assert.equal((await review(f.user.id, correction.id, 'APPROVED')).status, 403);
    assert.equal((await review(f.otherOffice.id, correction.id, 'APPROVED')).status, 404);
    const reviews = await Promise.all([review(f.office.id, correction.id, 'APPROVED'), review(f.office.id, correction.id, 'APPROVED')]);
    assert.deepEqual(reviews.map(response => response.status).sort(), [200, 409], 'a correction can only be approved once');
    const saved = await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    assert.equal(saved.hours, 4); assert.equal(saved.actualHours, 5); assert.equal(saved.actualAdditionalMinutes, 30);
    assert.equal((await review(f.office.id, correction.id, 'APPROVED')).status, 409);
    const next = await (await post()).json();
    assert.equal((await review(f.office.id, next.id, 'REJECTED')).status, 400);
    assert.equal((await review(f.office.id, next.id, 'REJECTED', 'Bitte mit dem Einsatz abgleichen.')).status, 200);
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).actualHours, 5);
    const foreign = await invoke(f.otherOffice.id, `/api/requests/${req.id}/hours`, 'GET', undefined, request => GET(request, { params: Promise.resolve({ id: req.id }) }));
    assert.equal(foreign.status, 404);
    const { PATCH: end } = await import('../src/app/api/requests/[id]/end/route');
    await invoke(f.user.id, `/api/requests/${req.id}/end`, 'PATCH', { action: 'CANCEL' }, request => end(request, { params: Promise.resolve({ id: req.id }) }));
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, 'ACCEPTED', 'approved work is never cancelled by a later cancellation');
    const ended = await db.request.findUniqueOrThrow({ where: { id: req.id } });
    assert.equal(ended.status, 'ENDED');
    assert.deepEqual(getOpenRequestDays(ended, [saved]), [], 'cancelled remaining demand cannot reopen around preserved actual work');
  });
  test('pending reports of delivered work survive cancellation and remain reviewable', async t => {
    const f = await fixture(t);
    const { POST } = await import('../src/app/api/assignments/[id]/hours/route');
    const { PATCH } = await import('../src/app/api/hour-corrections/[id]/route');
    const { GET } = await import('../src/app/api/hour-corrections/route');
    const { PATCH: end } = await import('../src/app/api/requests/[id]/end/route');
    const req = await f.makeRequest(0);
    const assignment = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(0), hours: 4, status: 'ACCEPTED' } });
    const response = await invoke(f.user.id, `/api/assignments/${assignment.id}/hours`, 'POST', { proposedHours: 3, reason: 'Unterricht früher beendet' }, request => POST(request, { params: Promise.resolve({ id: assignment.id }) }));
    assert.equal(response.status, 201);
    const correction = await response.json();
    const cancelled = await invoke(f.user.id, `/api/requests/${req.id}/end`, 'PATCH', { action: 'CANCEL' }, request => end(request, { params: Promise.resolve({ id: req.id }) }));
    assert.equal(cancelled.status, 200);
    const inbox = await invoke(f.office.id, '/api/hour-corrections', 'GET', undefined, GET);
    assert.equal(inbox.headers.get('cache-control'), 'private, no-store');
    assert.equal((await inbox.json()).requests[0].id, req.id);
    assert.equal((await (await invoke(f.otherOffice.id, '/api/hour-corrections', 'GET', undefined, GET)).json()).total, 0);
    assert.equal((await invoke(f.user.id, '/api/hour-corrections', 'GET', undefined, GET)).status, 403);
    const review = (decision: string) => invoke(f.office.id, `/api/hour-corrections/${correction.id}`, 'PATCH', { decision, reviewNote: 'Einsatz wurde inzwischen storniert.' }, request => PATCH(request, { params: Promise.resolve({ id: correction.id }) }));
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, 'ACCEPTED');
    assert.equal((await db.request.findUniqueOrThrow({ where: { id: req.id } })).status, 'ENDED');
    assert.equal((await review('APPROVED')).status, 200);
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).actualHours, 3);
    assert.equal((await (await invoke(f.office.id, '/api/hour-corrections', 'GET', undefined, GET)).json()).total, 0);
  });
  test('approved additional tasks survive cancellation even without teaching hours', async t => {
    const f = await fixture(t);
    const { PATCH } = await import('../src/app/api/requests/[id]/end/route');
    const req = await f.makeRequest(0);
    const assignment = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(0), hours: 4, actualHours: 0, actualAdditionalMinutes: 45, status: 'ACCEPTED' } });
    const response = await invoke(f.user.id, `/api/requests/${req.id}/end`, 'PATCH', { action: 'CANCEL' }, request => PATCH(request, { params: Promise.resolve({ id: req.id }) }));
    assert.equal(response.status, 200);
    const saved = await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    assert.equal(saved.status, 'ACCEPTED'); assert.equal(saved.actualHours, 0); assert.equal(saved.actualAdditionalMinutes, 45);
    const ended = await db.request.findUniqueOrThrow({ where: { id: req.id } });
    assert.equal(ended.status, 'ENDED'); assert.deepEqual(getOpenRequestDays(ended, [saved]), []);
  });

  test('a pending zero-work correction on a cancelled assignment remains rejectable but cannot be approved', async t => {
    const f = await fixture(t);
    const { POST } = await import('../src/app/api/assignments/[id]/hours/route');
    const { PATCH } = await import('../src/app/api/hour-corrections/[id]/route');
    const { GET } = await import('../src/app/api/hour-corrections/route');
    const { PATCH: end } = await import('../src/app/api/requests/[id]/end/route');
    const req = await f.makeRequest(0);
    const assignment = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(0), hours: 4, status: 'ACCEPTED' } });
    const response = await invoke(f.user.id, `/api/assignments/${assignment.id}/hours`, 'POST', { proposedHours: 0, reason: 'Kein Unterricht geleistet' }, request => POST(request, { params: Promise.resolve({ id: assignment.id }) }));
    const correction = await response.json();
    await invoke(f.user.id, `/api/requests/${req.id}/end`, 'PATCH', { action: 'CANCEL' }, request => end(request, { params: Promise.resolve({ id: req.id }) }));
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, 'REJECTED');
    assert.equal((await (await invoke(f.office.id, '/api/hour-corrections', 'GET', undefined, GET)).json()).requests[0].id, req.id);
    const review = (decision: string) => invoke(f.office.id, `/api/hour-corrections/${correction.id}`, 'PATCH', { decision, reviewNote: 'Einsatz wurde storniert.' }, request => PATCH(request, { params: Promise.resolve({ id: correction.id }) }));
    assert.equal((await review('APPROVED')).status, 409);
    assert.equal((await review('REJECTED')).status, 200);
  });

  test('leave preview and cancellation preserve approved and pending delivered work consistently', async t => {
    const f = await fixture(t);
    const { POST: preview } = await import('../src/app/api/teachers/leave/preview/route');
    const { POST: leave } = await import('../src/app/api/teachers/leave/route');
    const req = await f.makeRequest();
    const approved = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(-1), hours: 4, actualHours: 4, status: 'ACCEPTED' } });
    const reported = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(0), hours: 4, status: 'ACCEPTED' } });
    await db.assignmentHourCorrection.create({ data: { assignmentId: reported.id, plannedHours: 4, proposedHours: 3, reason: 'Unterricht übernommen', submittedById: f.user.id } });
    const future = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(1), hours: 4, status: 'ACCEPTED' } });
    const input = { teacherId: f.teacher.id, startDate: f.day(-1).toISOString().slice(0, 10), endDate: f.day(2).toISOString().slice(0, 10) };
    const response = await invoke(f.office.id, '/api/teachers/leave/preview', 'POST', input, preview);
    assert.equal(response.status, 200);
    const proposed = await response.json();
    assert.equal(proposed.cancelledAssignments, 1);
    assert.deepEqual(proposed.assignments.map((assignment: { id: string }) => assignment.id), [future.id]);
    const saved = await invoke(f.office.id, '/api/teachers/leave', 'POST', { ...input, previewToken: proposed.previewToken }, leave);
    assert.equal(saved.status, 201, await saved.clone().text());
    assert.equal((await saved.json()).cancelledAssignments, 1);
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: approved.id } })).status, 'ACCEPTED');
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: reported.id } })).status, 'ACCEPTED');
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: future.id } })).status, 'REJECTED');
  });

  test('early return keeps performed work without extending demand or reopening today', async t => {
    const f = await fixture(t);
    const { PATCH } = await import('../src/app/api/requests/[id]/end/route');
    const req = await f.makeRequest();
    const assignment = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(0), hours: 2, actualHours: 2, actualAdditionalMinutes: 30, status: 'ACCEPTED' } });
    const response = await invoke(f.user.id, `/api/requests/${req.id}/end`, 'PATCH', { lastDay: f.day(-1).toISOString().slice(0, 10) }, request => PATCH(request, { params: Promise.resolve({ id: req.id }) }));
    assert.equal(response.status, 200, await response.clone().text());
    const ended = await db.request.findUniqueOrThrow({ where: { id: req.id } });
    assert.equal(ended.endDate?.toISOString(), f.day(-1).toISOString());
    assert.equal(getOpenRequestDays(ended, [assignment]).some(day => day.date >= f.day(0).toISOString().slice(0, 10)), false);
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, 'ACCEPTED');
  });

  test('rejection finishes cancellation deferred for a positive report and retains all audit records', async t => {
    const f = await fixture(t);
    const { POST } = await import('../src/app/api/assignments/[id]/hours/route');
    const { PATCH } = await import('../src/app/api/hour-corrections/[id]/route');
    const { PATCH: end } = await import('../src/app/api/requests/[id]/end/route');
    const req = await f.makeRequest(0);
    const assignment = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(0), hours: 4, status: 'ACCEPTED' } });
    const report = await invoke(f.user.id, `/api/assignments/${assignment.id}/hours`, 'POST', { proposedHours: 2, reason: 'Unterricht gemeldet' }, request => POST(request, { params: Promise.resolve({ id: assignment.id }) }));
    const correction = await report.json();
    assert.equal((await invoke(f.user.id, `/api/requests/${req.id}/end`, 'PATCH', { action: 'CANCEL' }, request => end(request, { params: Promise.resolve({ id: req.id }) }))).status, 200);
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, 'ACCEPTED');
    const reviewed = await invoke(f.office.id, `/api/hour-corrections/${correction.id}`, 'PATCH', { decision: 'REJECTED', reviewNote: 'Unterricht wurde nicht geleistet.' }, request => PATCH(request, { params: Promise.resolve({ id: correction.id }) }));
    assert.equal(reviewed.status, 200, await reviewed.clone().text());
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, 'REJECTED');
    assert.equal((await db.assignmentHourCorrection.findUniqueOrThrow({ where: { id: correction.id } })).status, 'REJECTED');
    assert.equal(await db.requestLifecycleEvent.count({ where: { requestId: req.id } }), 1);
    const other = await f.makeRequest(0);
    await db.assignment.create({ data: { requestId: other.id, teacherId: f.teacher.id, date: f.day(0), hours: 4, status: 'ACCEPTED' } });
  });

  test('review retains approved work and past work, but confirmed zero work releases deferred cancellations', async t => {
    const f = await fixture(t);
    const { PATCH } = await import('../src/app/api/hour-corrections/[id]/route');
    const { PATCH: end } = await import('../src/app/api/requests/[id]/end/route');
    const req = await f.makeRequest();
    const current = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(0), hours: 4, actualHours: 3, status: 'ACCEPTED' } });
    const past = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(-1), hours: 4, status: 'ACCEPTED' } });
    const corrections = await Promise.all([current, past].map(assignment => db.assignmentHourCorrection.create({ data: { assignmentId: assignment.id, plannedHours: 4, previousActualHours: assignment.actualHours, proposedHours: 2, reason: 'Meldung zum Einsatz', submittedById: f.user.id } })));
    await invoke(f.user.id, `/api/requests/${req.id}/end`, 'PATCH', { action: 'CANCEL' }, request => end(request, { params: Promise.resolve({ id: req.id }) }));
    for (const correction of corrections) {
      const response = await invoke(f.office.id, `/api/hour-corrections/${correction.id}`, 'PATCH', { decision: 'REJECTED', reviewNote: 'Korrektur nicht bestätigt' }, request => PATCH(request, { params: Promise.resolve({ id: correction.id }) }));
      assert.equal(response.status, 200);
    }
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: current.id } })).status, 'ACCEPTED', 'previous approved work remains');
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: past.id } })).status, 'ACCEPTED', 'past work was never covered by cancellation');
    const zero = await db.assignmentHourCorrection.create({ data: { assignmentId: current.id, plannedHours: 4, previousActualHours: 3, proposedHours: 0, reason: 'Doch kein Unterricht', submittedById: f.user.id } });
    assert.equal((await invoke(f.office.id, `/api/hour-corrections/${zero.id}`, 'PATCH', { decision: 'APPROVED' }, request => PATCH(request, { params: Promise.resolve({ id: zero.id }) }))).status, 200);
    const saved = await db.assignment.findUniqueOrThrow({ where: { id: current.id } });
    assert.equal(saved.actualHours, 0); assert.equal(saved.status, 'REJECTED');
  });

  test('rejected reports also release assignments protected during leave and absence', async t => {
    const f = await fixture(t);
    const { PATCH } = await import('../src/app/api/hour-corrections/[id]/route');
    const req = await f.makeRequest();
    for (const [offset, kind] of [[-1, 'leave'], [0, 'absence']] as const) {
      const assignment = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(offset), hours: 4, status: 'ACCEPTED' } });
      const correction = await db.assignmentHourCorrection.create({ data: { assignmentId: assignment.id, plannedHours: 4, proposedHours: 3, reason: 'Gemeldeter Unterricht', submittedById: f.user.id } });
      if (kind === 'leave') await db.leavePeriod.create({ data: { teacherId: f.teacher.id, startDate: f.day(offset), endDate: new Date(f.day(offset).getTime() + 86399999), reportedBy: 'SCHULAMT' } });
      else await db.absence.create({ data: { teacherId: f.teacher.id, date: f.day(offset), type: 'UNAVAILABLE' } });
      assert.equal((await invoke(f.office.id, `/api/hour-corrections/${correction.id}`, 'PATCH', { decision: 'REJECTED', reviewNote: 'Kein Einsatz stattgefunden' }, request => PATCH(request, { params: Promise.resolve({ id: correction.id }) }))).status, 200);
      assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).status, 'REJECTED');
    }
  });

  test('performed work beyond shortened demand stays reachable across school-year boundaries', async t => {
    const f = await fixture(t);
    const { GET: exportGet } = await import('../src/app/api/export/route');
    const { GET: requestsGet } = await import('../src/app/api/requests/route');
    const { GET: hoursGet } = await import('../src/app/api/requests/[id]/hours/route');
    const { GET: historyGet } = await import('../src/app/api/requests/[id]/history/route');
    const { GET: workloadGet } = await import('../src/app/api/schulamt/workload/route');
    const year = getSchoolYearForDate(f.day(0));
    const start = new Date(`${year.slice(0, 4)}-09-01T00:00:00Z`);
    const beforeStart = new Date(start.getTime() - 86400000);
    const req = await db.request.create({ data: { schoolId: f.school.id, date: beforeStart, endDate: beforeStart, hours: 4, substitutedTeacher: 'Return across year', qualifications: '', status: 'ENDED' } });
    const assignment = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: start, hours: 4, actualHours: 2, actualAdditionalMinutes: 30, status: 'ACCEPTED' } });
    await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: beforeStart, hours: 4, status: 'ACCEPTED' } });
    const yearParam = encodeURIComponent(year);
    const requests = await (await invoke(f.user.id, `/api/requests?year=${yearParam}`, 'GET', undefined, requestsGet)).json();
    assert.ok(requests.some((row: { id: string }) => row.id === req.id));
    const hours = await (await invoke(f.user.id, `/api/requests/${req.id}/hours`, 'GET', undefined, request => hoursGet(request, { params: Promise.resolve({ id: req.id }) }))).json();
    assert.ok(hours.assignments.some((row: { id: string; actualHours: number }) => row.id === assignment.id && row.actualHours === 2));
    const before = new Date(start.getTime() + 86400000).toISOString().slice(0, 10);
    const history = await (await invoke(f.office.id, `/api/requests/${req.id}/history?before=${before}`, 'GET', undefined, request => historyGet(request, { params: Promise.resolve({ id: req.id }) }))).json();
    assert.equal(history.entries.length, 1);
    const workload = await (await invoke(f.office.id, `/api/schulamt/workload?year=${yearParam}`, 'GET', undefined, workloadGet)).json();
    assert.equal(workload.teachers[0].total.actualHours, 2);
    const exported = await invoke(f.office.id, `/api/export?year=${yearParam}`, 'GET', undefined, exportGet);
    assert.equal(exported.status, 200);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await exported.arrayBuffer());
    const sheet = workbook.getWorksheet('Einsätze')!;
    assert.equal(sheet.rowCount, 2, 'only the assignment inside the selected year is exported');
    assert.equal(sheet.getRow(2).getCell(8).value, 2);
    assert.equal(sheet.getRow(2).getCell(9).value, 30);
    const foreign = await invoke(f.otherOffice.id, `/api/export?year=${yearParam}`, 'GET', undefined, exportGet);
    const foreignBook = new ExcelJS.Workbook(); await foreignBook.xlsx.load(await foreign.arrayBuffer());
    assert.equal(foreignBook.getWorksheet('Einsätze')!.rowCount, 1);
  });

  test('leave end dates round-trip without blocking or cancelling the following day', async t => {
    const f = await fixture(t);
    const { POST: preview } = await import('../src/app/api/teachers/leave/preview/route');
    const { PATCH } = await import('../src/app/api/teachers/leave/[leaveId]/route');
    const { findOverlappingLeave } = await import('../src/lib/leaveService');
    const req = await f.makeRequest();
    const next = await db.assignment.create({ data: { requestId: req.id, teacherId: f.teacher.id, date: f.day(2), hours: 4, status: 'ACCEPTED' } });
    const leave = await db.leavePeriod.create({ data: { teacherId: f.teacher.id, startDate: f.day(0), endDate: new Date(f.day(1).getTime() + 86399999), reportedBy: 'SCHULAMT' } });
    assert.equal(await db.$transaction(tx => findOverlappingLeave(tx, f.teacher.id, f.day(2), f.day(3))), null, 'adjacent leave days do not overlap');
    const payload = { teacherId: f.teacher.id, startDate: f.day(-1).toISOString().slice(0, 10), endDate: f.day(1).toISOString().slice(0, 10) };
    const proposed = await (await invoke(f.office.id, '/api/teachers/leave/preview', 'POST', payload, preview)).json();
    const result = await invoke(f.office.id, `/api/teachers/leave/${leave.id}`, 'PATCH', { startDate: payload.startDate, previewToken: proposed.previewToken }, request => PATCH(request, { params: Promise.resolve({ leaveId: leave.id }) }));
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal((await db.leavePeriod.findUniqueOrThrow({ where: { id: leave.id } })).endDate?.toISOString(), leave.endDate?.toISOString());
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: next.id } })).status, 'ACCEPTED');
  });

}
