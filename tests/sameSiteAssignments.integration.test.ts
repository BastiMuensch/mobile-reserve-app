import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { DoubleBookingError, validateAndCreateAssignments } from '../src/lib/assignService';
import { toCanonicalUtcDate } from '../src/lib/dateKey';
import { getSchoolYearForDate } from '../src/lib/schoolYear';
import type { SchoolProposal } from '../src/lib/batchMatching';
import type { CompanionRequestOption } from '../src/lib/companionRequests';

const url = process.env.TEST_DATABASE_URL;
if (!url) test('same-site assignment blocks', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'same-site-assignment-test-secret';
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString('base64');
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
  const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
  const db = new PrismaClient({ datasourceUrl: url });
  test.after(async () => { hook.deregister(); await db.$disconnect(); });
  const date = new Date('2026-11-09T00:00:00Z');

  function nextWeekday(after = new Date()) {
    const result = toCanonicalUtcDate(after);
    do { result.setUTCDate(result.getUTCDate() + 1); } while ([0, 6].includes(result.getUTCDay()));
    return result;
  }

  async function fixture(t: test.TestContext, deploymentDate = date) {
    const dateKey = deploymentDate.toISOString().slice(0, 10);
    const office = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, password: 'hash', role: 'SCHULAMT' } });
    const school = await db.school.create({ data: { name: 'Shared day', address: 'Testweg', type: 'GRUNDSCHULE', schulamtId: office.id, latitude: 48, longitude: 11 } });
    const otherSchool = await db.school.create({ data: { name: 'Other school', address: 'Testweg', type: 'GRUNDSCHULE', schulamtId: office.id } });
    const location = await db.schoolLocation.create({ data: { schoolId: school.id, name: 'Außenstelle', address: 'Nebenweg' } });
    const teacher = await db.teacher.create({ data: {
      name: 'Reserve', stammschuleId: school.id, schoolYear: getSchoolYearForDate(deploymentDate), qualifications: 'Grundschule',
      homeLat: 48, homeLng: 11, preferredType: 'BOTH', maxWeeklyHours: 28, status: 'ACTIVE',
    } });
    t.after(async () => {
      await db.assignment.deleteMany({ where: { teacherId: teacher.id } });
      await db.requestLifecycleEvent.deleteMany({ where: { request: { schoolId: { in: [school.id, otherSchool.id] } } } });
      await db.request.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.schoolLocation.delete({ where: { id: location.id } });
      await db.emailOutbox.deleteMany({ where: { schulamtId: office.id } });
      await db.school.deleteMany({ where: { id: { in: [school.id, otherSchool.id] } } });
      await db.user.delete({ where: { id: office.id } });
    });
    const request = (startHour = 1, overrides: { schoolId?: string; locationId?: string; status?: string; endDate?: Date } = {}) => db.request.create({ data: {
      schoolId: school.id, date: deploymentDate, startHour, hours: 3, substitutedTeacher: `Lehrkraft ${startHour}`, qualifications: 'Grundschule', status: 'PENDING', ...overrides,
    } });
    const assign = (requestId: string) => db.$transaction(tx => validateAndCreateAssignments(tx, {
      requestId, teacherId: teacher.id, schulamtId: office.id, entries: [{ date: dateKey, hours: 3 }],
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const raw = (requestId: string, lessonHours: string | null) => ({ requestId, teacherId: teacher.id, date: deploymentDate, hours: 3, lessonHours, status: 'ACCEPTED' });
    return { office, school, otherSchool, location, teacher, request, assign, raw, dateKey, date: deploymentDate };
  }

  test('two 3-hour requests at the same site are covered separately with six total hours', async t => {
    const f = await fixture(t);
    const morning = await f.request(1);
    const afternoon = await f.request(4);
    await f.assign(morning.id);
    await f.assign(afternoon.id);
    const assignments = await db.assignment.findMany({ where: { teacherId: f.teacher.id }, orderBy: { lessonHours: 'asc' } });
    assert.deepEqual(assignments.map(row => row.lessonHours), ['[1,2,3]', '[4,5,6]']);
    assert.equal(assignments.reduce((sum, row) => sum + row.hours, 0), 6);
    assert.equal((await db.request.findUniqueOrThrow({ where: { id: morning.id } })).status, 'FILLED');
    assert.equal((await db.request.findUniqueOrThrow({ where: { id: afternoon.id } })).status, 'FILLED');
    await db.assignment.update({ where: { id: assignments[0].id }, data: { status: 'REJECTED' } });
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: assignments[1].id } })).status, 'PENDING');
    assert.equal((await db.request.findUniqueOrThrow({ where: { id: afternoon.id } })).status, 'FILLED');
  });

  test('three-hour bookings keep other schools/sites locked and forbid overlap or unknown legacy lessons', async t => {
    const f = await fixture(t);
    const morning = await f.request(1);
    await f.assign(morning.id);
    for (const candidate of [
      await f.request(3), await f.request(4, { schoolId: f.otherSchool.id }), await f.request(4, { locationId: f.location.id }),
    ]) await assert.rejects(f.assign(candidate.id), DoubleBookingError);
    const first = await db.assignment.findFirstOrThrow({ where: { requestId: morning.id } });
    await db.assignment.update({ where: { id: first.id }, data: { lessonHours: null } });
    await assert.rejects(f.assign((await f.request(4)).id), DoubleBookingError);
  });

  test('database guard validates imports, duplicate requests, reactivation and moving school sites', async t => {
    const f = await fixture(t);
    const morning = await f.request(1);
    const afternoon = await f.request(4);
    await db.assignment.createMany({ data: [f.raw(morning.id, '[1,2,3]'), f.raw(afternoon.id, '[4,5,6]')] });
    await assert.rejects(db.assignment.create({ data: f.raw(morning.id, '[7,8,9]') }));
    await assert.rejects(db.request.update({ where: { id: afternoon.id }, data: { locationId: f.location.id } }));
    const cancelled = await f.request(1, { status: 'CANCELLED' });
    await db.assignment.create({ data: f.raw(cancelled.id, '[1,2,3]') });
    await assert.rejects(db.request.update({ where: { id: cancelled.id }, data: { status: 'PENDING' } }));
    const rejected = await db.assignment.create({ data: { ...f.raw((await f.request(1)).id, '[1,2,3]'), status: 'REJECTED' } });
    await assert.rejects(db.assignment.update({ where: { id: rejected.id }, data: { status: 'ACCEPTED' } }));
    const valid = await db.assignment.findFirstOrThrow({ where: { requestId: afternoon.id } });
    await assert.rejects(db.assignment.update({ where: { id: valid.id }, data: { lessonHours: null } }));
    assert.equal(await db.assignment.count({ where: { teacherId: f.teacher.id, request: { status: { not: 'CANCELLED' } }, status: 'ACCEPTED' } }), 2);
  });

  test('concurrent direct database writes cannot bypass school/day or lesson overlap guards', async t => {
    for (const scenario of ['overlap', 'different-school', 'compatible'] as const) {
      const f = await fixture(t);
      const first = await f.request(1);
      const second = await f.request(scenario === 'overlap' ? 1 : 4, scenario === 'different-school' ? { schoolId: f.otherSchool.id } : {});
      const results = await Promise.allSettled([
        db.assignment.create({ data: f.raw(first.id, '[1,2,3]') }),
        db.assignment.create({ data: f.raw(second.id, scenario === 'overlap' ? '[1,2,3]' : '[4,5,6]') }),
      ]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, scenario === 'compatible' ? 2 : 1, scenario);
    }
  });

  async function invoke(userId: string, body: unknown) {
    const { POST } = await import('../src/app/api/assign/route');
    return invokeRoute(userId, '/api/assign', 'POST', body, POST);
  }

  async function invokeRoute(userId: string, path: string, method: string, body: unknown, handler: (request: Request) => Promise<Response>) {
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const request = new Request(`http://localhost${path}`, { method, headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const store = createRequestStoreForAPI(request as never, { pathname: path, search: '' }, [] as never, undefined, undefined, undefined);
    return workAsyncStorage.run({ route: path, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(request)));
  }

  test('grouped assignment API saves all selected requests atomically and rolls back conflicts', async t => {
    for (const compatible of [true, false]) {
      const f = await fixture(t);
      const first = await f.request(1);
      const second = await f.request(compatible ? 4 : 3);
      const assignments = [{ date: '2026-11-09', hours: 3 }];
      const response = await invoke(f.office.id, {
        requestId: first.id, teacherId: f.teacher.id, assignments,
        additionalAssignments: [{ requestId: second.id, assignments }],
      });
      assert.equal(response.status, compatible ? 201 : 409, await response.clone().text());
      assert.equal(await db.assignment.count({ where: { teacherId: f.teacher.id } }), compatible ? 2 : 0);
      if (compatible) {
        const body = await response.json();
        assert.equal(body.count, 2);
        assert.deepEqual(body.assignedRequestIds, [first.id, second.id]);
      } else {
        assert.equal((await db.request.findUniqueOrThrow({ where: { id: first.id } })).status, 'PENDING');
        assert.equal(await db.emailOutbox.count({ where: { schulamtId: f.office.id } }), 0);
      }
    }
  });

  test('grouped assignment API rejects different sites, duplicate requests and extra dates without partial writes', async t => {
    const f = await fixture(t);
    const first = await f.request(1);
    const otherSite = await f.request(4, { locationId: f.location.id });
    const assignments = [{ date: '2026-11-09', hours: 3 }];
    for (const [additionalAssignments, expectedStatus] of [
      [[{ requestId: otherSite.id, assignments }], 403],
      [[{ requestId: first.id, assignments }], 400],
      [[{ requestId: otherSite.id, assignments: [{ date: '2026-11-10', hours: 3 }] }], 400],
    ] as const) {
      const response = await invoke(f.office.id, {
        requestId: first.id, teacherId: f.teacher.id, assignments, additionalAssignments,
      });
      assert.equal(response.status, expectedStatus, await response.clone().text());
      assert.equal(await db.assignment.count({ where: { teacherId: f.teacher.id } }), 0);
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: first.id } })).status, 'PENDING');
    }
  });

  test('match API offers a 3+3 companion and keeps the assigned reserve available only at the same site', async t => {
    const f = await fixture(t, nextWeekday());
    const morning = await f.request(1);
    const afternoon = await f.request(4);
    const foreign = await f.request(4, { schoolId: f.otherSchool.id });
    const otherSite = await f.request(4, { locationId: f.location.id });
    const { GET } = await import('../src/app/api/match/[requestId]/route');
    async function match(requestId: string) {
      const response = await invokeRoute(f.office.id, `/api/match/${requestId}`, 'GET', undefined,
        request => GET(request, { params: Promise.resolve({ requestId }) }));
      assert.equal(response.status, 200, await response.clone().text());
      return await response.json() as { candidates: { id: string; companionRequests: CompanionRequestOption[] }[]; manualCandidates: { id: string }[] };
    }
    const before = await match(morning.id);
    const candidate = before.candidates.find(item => item.id === f.teacher.id);
    assert.ok(candidate);
    assert.deepEqual(candidate.companionRequests.map(item => item.requestId), [afternoon.id]);
    assert.deepEqual(candidate.companionRequests[0].entries, [{ date: f.dateKey, hours: 3, lessonHours: '[4,5,6]' }]);

    const assigned = await invoke(f.office.id, {
      requestId: morning.id, teacherId: f.teacher.id, assignments: [{ date: f.dateKey, hours: 3 }],
    });
    assert.equal(assigned.status, 201, await assigned.clone().text());
    const after = await match(afternoon.id);
    assert.deepEqual(after.candidates.map(item => item.id), [f.teacher.id]);
    assert.deepEqual(after.candidates[0].companionRequests, [], 'already covered morning is no longer offered');
    for (const requestId of [foreign.id, otherSite.id]) {
      const blocked = await match(requestId);
      assert.deepEqual(blocked.candidates, []);
      assert.deepEqual(blocked.manualCandidates, [], 'manual candidates preserve the school/site day lock too');
    }
  });

  test('batch preview proposes both 3-hour blocks to one reserve and approval persists both', async t => {
    const f = await fixture(t, nextWeekday());
    const morning = await f.request(1);
    const afternoon = await f.request(4);
    const { POST: preview } = await import('../src/app/api/batch-assign/preview/route');
    const { POST: approve } = await import('../src/app/api/batch-assign/approve/route');
    const window = { schoolYear: f.teacher.schoolYear, until: f.dateKey };
    const previewResponse = await invokeRoute(f.office.id, '/api/batch-assign/preview', 'POST', window, preview);
    assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
    const result = await previewResponse.json() as { schools: SchoolProposal[] };
    const school = result.schools.find(item => item.schoolId === f.school.id);
    assert.ok(school);
    assert.equal(school.coverage.assignedHours, 6);
    assert.equal(school.coverage.filledRequests, 2);
    assert.deepEqual(school.proposals.map(item => item.requestId).sort(), [morning.id, afternoon.id].sort());
    assert.deepEqual([...new Set(school.proposals.flatMap(item => item.segments.map(segment => segment.teacherId)))], [f.teacher.id]);
    const approved = await invokeRoute(f.office.id, '/api/batch-assign/approve', 'POST', {
      ...window, schoolId: f.school.id,
      items: school.proposals.map(item => ({ requestId: item.requestId, segments: item.segments })),
    }, approve);
    assert.equal(approved.status, 201, await approved.clone().text());
    const assignments = await db.assignment.findMany({ where: { teacherId: f.teacher.id }, orderBy: { lessonHours: 'asc' } });
    assert.deepEqual(assignments.map(item => item.lessonHours), ['[1,2,3]', '[4,5,6]']);
    assert.equal(assignments.reduce((total, item) => total + item.hours, 0), 6);
  });

  test('school cancellation or early return removes only its own block and keeps the companion active', async t => {
    const { PATCH } = await import('../src/app/api/requests/[id]/end/route');
    for (const action of ['CANCEL', 'END'] as const) {
      const f = await fixture(t, nextWeekday());
      const secondDay = nextWeekday(f.date);
      const morning = await f.request(1, { endDate: secondDay });
      const afternoon = await f.request(4, { endDate: secondDay });
      const rows = [
        f.raw(morning.id, '[1,2,3]'), f.raw(afternoon.id, '[4,5,6]'),
        { ...f.raw(morning.id, '[1,2,3]'), date: secondDay },
        { ...f.raw(afternoon.id, '[4,5,6]'), date: secondDay },
      ];
      await db.assignment.createMany({ data: rows });
      const schoolUser = await db.user.create({ data: {
        email: `${randomUUID()}@example.invalid`, password: 'hash', role: 'SCHOOL', schoolId: f.school.id,
      } });
      t.after(() => db.user.deleteMany({ where: { id: schoolUser.id } }));
      const response = await invokeRoute(schoolUser.id, `/api/requests/${morning.id}/end`, 'PATCH',
        action === 'CANCEL' ? { action: 'CANCEL' } : { action: 'END', lastDay: f.dateKey },
        request => PATCH(request, { params: Promise.resolve({ id: morning.id }) }));
      assert.equal(response.status, 200, await response.clone().text());
      const firstRows = await db.assignment.findMany({ where: { requestId: morning.id }, orderBy: { date: 'asc' } });
      assert.deepEqual(firstRows.map(item => item.status), action === 'CANCEL' ? ['REJECTED', 'REJECTED'] : ['ACCEPTED', 'REJECTED']);
      const companionRows = await db.assignment.findMany({ where: { requestId: afternoon.id } });
      assert.equal(companionRows.length, 2);
      assert.ok(companionRows.every(item => item.status === 'ACCEPTED'));
      assert.equal(await db.requestLifecycleEvent.count({ where: { requestId: morning.id, action } }), 1);
      assert.equal(await db.requestLifecycleEvent.count({ where: { requestId: afternoon.id } }), 0);
      await db.user.delete({ where: { id: schoolUser.id } });
    }
  });
}
