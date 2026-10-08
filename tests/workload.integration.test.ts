import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import type { WorkloadReport } from '../src/lib/workload';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('Workload HTTP integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(testDbUrl).pathname).replace(/^\/+|\/+$/g, '');
  assert.match(databaseName, /(?:^|[_-])test(?:[_-]|$)/i, 'only an explicitly named test database is permitted');
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'workload-integration-test-secret';
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('workload requires an office and isolates tenants, school years and active assignment status', async () => {
    const { GET } = await import('../src/app/api/schulamt/workload/route');
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const users: string[] = [], schools: string[] = [];
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const path = '/api/schulamt/workload';
    const invoke = async (userId?: string, year = '2026/2027') => {
      const token = userId ? await signToken({ id: userId, sessionVersion: 0 }) : null;
      const request = new Request(`http://localhost${path}?year=${encodeURIComponent(year)}`, {
        headers: token ? { cookie: `session_token=${token}` } : {},
      });
      const store = createRequestStoreForAPI(request as never, { pathname: path, search: new URL(request.url).search }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: path, forceStatic: false, dynamicShouldError: false } as never, () =>
        workUnitAsyncStorage.run(store, () => GET(request)));
    };

    try {
      for (const role of ['SCHULAMT', 'SCHULAMT', 'TEACHER', 'SCHOOL']) {
        users.push((await db.user.create({ data: { email: `workload-${users.length}-${suffix}@test.local`, password: 'unused', role } })).id);
      }
      for (const owner of users.slice(0, 2)) {
        schools.push((await db.school.create({ data: { name: `Workload Test ${schools.length}`, address: 'Testweg', type: 'GRUNDSCHULE', schulamtId: owner } })).id);
      }
      await db.user.update({ where: { id: users[3] }, data: { schoolId: schools[0] } });
      const baseTeacher = { name: 'MR Test', status: 'ACTIVE', maxWeeklyHours: 28, qualifications: '', homeLat: 0, homeLng: 0, preferredType: 'BOTH', schoolYear: '2026/2027' };
      const owned = await db.teacher.create({ data: { ...baseTeacher, stammschuleId: schools[0], userId: users[2] } });
      const zero = await db.teacher.create({ data: { ...baseTeacher, name: 'Ohne Einsätze', stammschuleId: schools[0] } });
      const leave = await db.teacher.create({ data: { ...baseTeacher, name: 'Beurlaubt mit Historie', status: 'LEAVE', stammschuleId: schools[0] } });
      const foreign = await db.teacher.create({ data: { ...baseTeacher, stammschuleId: schools[1] } });
      const old = await db.teacher.create({ data: { ...baseTeacher, schoolYear: '2025/2026', stammschuleId: schools[0] } });
      await db.teacher.create({ data: { ...baseTeacher, status: 'PENDING', stammschuleId: schools[0] } });
      const baseRequest = { date: new Date('2026-09-01T00:00:00Z'), hours: 4, weeklyHours: 4, schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Test', qualifications: '', status: 'FILLED' };
      const ownRequest = await db.request.create({ data: { ...baseRequest, schoolId: schools[0] } });
      const foreignRequest = await db.request.create({ data: { ...baseRequest, schoolId: schools[1] } });
      const cancelled = await db.request.create({ data: { ...baseRequest, status: 'CANCELLED', schoolId: schools[0] } });
      const add = (teacherId: string, requestId: string, date: string, hours: number, status = 'ACCEPTED') => ({ teacherId, requestId, date: new Date(`${date}T00:00:00Z`), hours, status });
      await db.assignment.createMany({ data: [
        add(owned.id, ownRequest.id, '2026-09-01', 3), add(owned.id, ownRequest.id, '2026-09-02', 2, 'PENDING'),
        add(owned.id, ownRequest.id, '2027-08-31', 4),
        add(owned.id, ownRequest.id, '2026-09-02', 40, 'REJECTED'),
        add(owned.id, cancelled.id, '2026-09-03', 40),
        add(owned.id, ownRequest.id, '2026-08-31', 40), add(owned.id, ownRequest.id, '2027-09-01', 40),
        add(owned.id, foreignRequest.id, '2026-09-04', 40), // Malformed cross-tenant link must not leak into totals.
        add(foreign.id, ownRequest.id, '2026-09-04', 40),
        add(old.id, ownRequest.id, '2026-09-05', 40),
        add(old.id, ownRequest.id, '2026-08-31', 6),
        add(leave.id, ownRequest.id, '2026-09-01', 1),
      ] });

      assert.equal((await invoke()).status, 401);
      assert.equal((await invoke(users[2])).status, 403);
      assert.equal((await invoke(users[3])).status, 403);
      for (const invalidYear of ['invalid', '2026/2028']) assert.equal((await invoke(users[0], invalidYear)).status, 400);
      const response = await invoke(users[0]);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const report = await response.json() as WorkloadReport;
      assert.equal(report.schoolYear, '2026/2027');
      assert.deepEqual(report.teachers.map(row => row.id).sort(), [owned.id, zero.id, leave.id].sort());
      const row = report.teachers.find(item => item.id === owned.id)!;
      assert.deepEqual(row.total, { hours: 9, accepted: 7, pending: 2, days: 3 });
      assert.equal(row.weeks[0].start, '2026-09-01');
      assert.equal(row.weeks.at(-1)!.end, '2027-08-31');
      assert.equal(report.teachers.find(item => item.id === zero.id)!.total.hours, 0);
      assert.equal(report.teachers.find(item => item.id === leave.id)!.total.hours, 1, 'current leave does not erase assignment history');
      assert.equal('email' in row, false);
      assert.equal('address' in row, false);
      const previous = await (await invoke(users[0], '2025/2026')).json() as WorkloadReport;
      assert.deepEqual(previous.teachers.map(item => item.id), [old.id]);
      assert.equal(previous.teachers[0].total.hours, 6);
      const otherOffice = await (await invoke(users[1])).json() as WorkloadReport;
      assert.deepEqual(otherOffice.teachers.map(item => item.id), [foreign.id]);
      assert.equal(otherOffice.teachers[0].total.hours, 0, 'cross-tenant request is not included for either office');
    } finally {
      await db.assignment.deleteMany({ where: { OR: [{ request: { schoolId: { in: schools } } }, { teacher: { stammschuleId: { in: schools } } }] } });
      await db.request.deleteMany({ where: { schoolId: { in: schools } } });
      await db.teacher.deleteMany({ where: { stammschuleId: { in: schools } } });
      await db.user.deleteMany({ where: { id: { in: users.slice(2) } } });
      await db.school.deleteMany({ where: { id: { in: schools } } });
      await db.user.deleteMany({ where: { id: { in: users.slice(0, 2) } } });
      await db.$disconnect();
      const { prisma } = await import('../src/lib/prisma');
      await prisma.$disconnect();
    }
  });
}
