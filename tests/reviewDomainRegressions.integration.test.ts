import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { ReportingRow } from '../src/lib/governmentReport';
import type { TeacherData } from '../src/types/models';

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  test('review domain regressions', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'domain-review-regression-test-secret';
  if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
  const db = new PrismaClient({ datasourceUrl: testDbUrl });
  const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
  test.after(async () => { hook.deregister(); await db.$disconnect(); });

  async function invoke(userId: string, path: string, handler: (request: Request) => Promise<Response>) {
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const request = new Request(`http://localhost${path}`, { headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}` } });
    const url = new URL(request.url);
    const store = createRequestStoreForAPI(request as never, { pathname: url.pathname, search: url.search }, [] as never, undefined, undefined, undefined);
    return workAsyncStorage.run({ route: url.pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(request)));
  }

  async function fixture(t: test.TestContext) {
    const office = await db.user.create({ data: { email: `domain-office-${randomUUID()}@test.invalid`, password: 'unused', role: 'SCHULAMT' } });
    const school = await db.school.create({ data: { name: 'Domain regression school', address: 'Testweg', type: 'GRUNDSCHULE', schulamtId: office.id } });
    const logins: string[] = [];
    t.after(async () => {
      await db.assignment.deleteMany({ where: { request: { schoolId: school.id } } });
      await db.request.deleteMany({ where: { schoolId: school.id } });
      await db.teacher.deleteMany({ where: { stammschuleId: school.id } });
      await db.school.delete({ where: { id: school.id } });
      await db.user.deleteMany({ where: { id: { in: [office.id, ...logins] } } });
    });
    const createTeacher = (name: string, extra: { schoolYear?: string; userId?: string } = {}) => db.teacher.create({ data: {
      name, stammschuleId: school.id, schoolYear: '2026/2027', qualifications: '', homeLat: 48, homeLng: 11,
      preferredType: 'BOTH', maxWeeklyHours: 6, status: 'ACTIVE', ...extra,
    } });
    return { office, school, createTeacher, logins };
  }

  test('monthly report inherits leave from another school-year profile and releases it on the right day', async t => {
    const f = await fixture(t);
    const login = await db.user.create({ data: { email: `domain-teacher-${randomUUID()}@test.invalid`, password: 'unused', role: 'TEACHER' } });
    f.logins.push(login.id);
    const prior = await f.createTeacher('Same person', { schoolYear: '2025/2026', userId: login.id });
    const current = await f.createTeacher('Same person', { userId: login.id });
    const other = await f.createTeacher('Another person');
    await db.leavePeriod.create({ data: { teacherId: prior.id, startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-11-05T23:59:59.999Z'), reportedBy: 'TEACHER' } });
    const { GET } = await import('../src/app/api/schulamt/government-reports/route');
    for (const [date, expected] of [['2026-11-05', 'UNAVAILABLE'], ['2026-11-06', 'READY']] as const) {
      const response = await invoke(f.office.id, `/api/schulamt/government-reports?date=${date}`, GET);
      assert.equal(response.status, 200, await response.clone().text());
      const { rows } = await response.json() as { rows: ReportingRow[] };
      assert.equal(rows.find(row => row.teacherId === current.id)?.suggestedState, expected);
      assert.equal(rows.find(row => row.teacherId === other.id)?.suggestedState, 'READY');
      assert.equal(rows.some(row => row.teacherId === prior.id), false, 'the prior-year profile is not counted again');
    }
  });

  test('reserve API uses Berlin calendar days for leave under UTC and Berlin server timezones', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-04T23:05:00Z') });
    const originalTimezone = process.env.TZ;
    t.after(() => { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; });
    const f = await fixture(t);
    const cases = [
      { name: 'Ended yesterday', start: '2026-11-01T00:00:00Z', end: '2026-11-04T23:59:59.999Z', current: false, visible: false },
      { name: 'Ends today', start: '2026-11-01T00:00:00Z', end: '2026-11-05T23:59:59.999Z', current: true, visible: true },
      { name: 'Starts today', start: '2026-11-05T00:00:00Z', end: null, current: true, visible: true },
      { name: 'Starts tomorrow', start: '2026-11-06T00:00:00Z', end: null, current: false, visible: true },
      { name: 'Legacy midnight end today', start: '2026-11-01T00:00:00Z', end: '2026-11-04T23:00:00Z', current: true, visible: true },
    ];
    for (const row of cases) {
      const teacher = await f.createTeacher(row.name);
      await db.leavePeriod.create({ data: { teacherId: teacher.id, startDate: new Date(row.start), endDate: row.end ? new Date(row.end) : null, reportedBy: 'SCHULAMT' } });
    }
    const { GET } = await import('../src/app/api/teachers/route');
    for (const timezone of ['UTC', 'Europe/Berlin']) {
      process.env.TZ = timezone;
      for (const now of ['2026-11-04T23:05:00Z', '2026-11-05T12:00:00Z']) {
        t.mock.timers.setTime(new Date(now).getTime());
        const response = await invoke(f.office.id, '/api/teachers?year=2026%2F2027', GET);
        assert.equal(response.status, 200, await response.clone().text());
        const teachers = await response.json() as TeacherData[];
        for (const row of cases) {
          const teacher = teachers.find(teacher => teacher.name === row.name)!;
          assert.equal(Boolean(teacher.currentLeave), row.current, `${timezone}, ${now}: ${row.name}`);
          assert.equal(Boolean(teacher.leavePeriods?.length), row.visible, `${timezone}, ${now}: listed ${row.name}`);
        }
      }
    }
  });

  test('reserve list API supplies actual hours and excludes cancelled bookings from weekly capacity', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') });
    const f = await fixture(t);
    const teacher = await f.createTeacher('Workload correction');
    const day = new Date('2026-11-05T00:00:00Z');
    const requestData = { schoolId: f.school.id, date: day, hours: 6, startHour: 1, substitutedTeacher: 'Test', qualifications: '', status: 'FILLED' };
    const request = await db.request.create({ data: requestData });
    const cancelledRequest = await db.request.create({ data: { ...requestData, status: 'CANCELLED' } });
    const active = await db.assignment.create({ data: { teacherId: teacher.id, requestId: request.id, date: day, hours: 6, actualHours: 2, status: 'ACCEPTED' } });
    await db.assignment.create({ data: { teacherId: teacher.id, requestId: cancelledRequest.id, date: day, hours: 6, status: 'ACCEPTED' } });
    await db.assignment.create({ data: { teacherId: teacher.id, requestId: request.id, date: day, hours: 6, status: 'CANCELLED' } });
    const { GET } = await import('../src/app/api/teachers/route');
    const response = await invoke(f.office.id, '/api/teachers?year=2026%2F2027', GET);
    assert.equal(response.status, 200, await response.clone().text());
    const [listed] = await response.json() as TeacherData[];
    assert.deepEqual(listed.assignments.map(assignment => ({ id: assignment.id, hours: assignment.hours, actualHours: assignment.actualHours })), [
      { id: active.id, hours: 6, actualHours: 2 },
    ]);
  });
}
