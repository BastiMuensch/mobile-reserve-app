import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { GovernmentReportInput, ReportingRow } from '../src/lib/governmentReport';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  test('Government reports HTTP integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'government-report-test-secret';
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
  test('tenant isolation, persistence, dated facts, review gate, concurrency, backup and immutable export', async () => {
    const { GET, POST } = await import('../src/app/api/schulamt/government-reports/route');
    const { GET: exportReport } = await import('../src/app/api/schulamt/government-reports/export/route');
    const { generateBackupData } = await import('../src/lib/backup');
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = `${Date.now()}-${Math.random()}`;
    const users: string[] = [], schools: string[] = [];
    const path = '/api/schulamt/government-reports';
    const invoke = async (handler: (req: Request) => Promise<Response>, url: string, userId?: string, body?: unknown) => {
      const token = userId ? await signToken({ id: userId, sessionVersion: 0 }) : null;
      const req = new Request(`http://localhost${url}`, { method: body ? 'POST' : 'GET', headers: {
        ...(token ? { cookie: `session_token=${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const pathname = new URL(req.url).pathname;
      const store = createRequestStoreForAPI(req as never, { pathname, search: new URL(req.url).search }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(req)));
    };
    try {
      for (const role of ['SCHULAMT', 'SCHULAMT', 'TEACHER']) {
        users.push((await db.user.create({ data: { email: `report-${users.length}-${suffix}@test.local`, role, password: 'unused' } })).id);
      }
      for (const owner of users.slice(0, 2)) schools.push((await db.school.create({ data: { name: 'Testschule', address: 'Testweg', type: 'GRUNDSCHULE', schulamtId: owner } })).id);
      const data = { name: 'MR Test', maxWeeklyHours: 15, qualifications: '', status: 'ACTIVE', homeLat: 0, homeLng: 0, postalCode: '80331', preferredType: 'BOTH', schoolYear: '2026/2027' };
      const owned = await db.teacher.create({ data: { ...data, stammschuleId: schools[0] } });
      const foreign = await db.teacher.create({ data: { ...data, stammschuleId: schools[1] } });
      await db.teacher.create({ data: { ...data, status: 'PENDING', stammschuleId: schools[0] } });
      await db.teacher.create({ data: { ...data, schoolYear: '2025/2026', stammschuleId: schools[0] } });
      assert.equal((await invoke(GET, `${path}?date=2026-09-15`)).status, 401);
      assert.equal((await invoke(GET, `${path}?date=2026-09-15`, users[2])).status, 403);
      assert.equal((await invoke(POST, path, users[2], {})).status, 403);
      assert.equal((await invoke(exportReport, `${path}/export?date=2026-09-15`, users[2])).status, 403);
      assert.equal((await invoke(GET, `${path}?date=2026-02-30`, users[0])).status, 400);
      const response = await invoke(GET, `${path}?date=2026-09-15`, users[0]); assert.equal(response.status, 200);
      const loaded = await response.json() as { rows: ReportingRow[] };
      assert.deepEqual(loaded.rows.map(r => r.teacherId), [owned.id]);
      const draft: GovernmentReportInput = { date: '2026-09-15', office: 'TEST', internalShort: null, internalLong: null, reviewed: false, expectedUpdatedAt: null,
        entries: loaded.rows.map(({ teacherId, state, setting }) => ({ teacherId, state, setting: { ...setting, category: 'GS_MS', effectiveFrom: '2026-09-01' } })) };
      assert.equal((await invoke(POST, path, users[0], { ...draft, entries: [{ ...draft.entries[0], teacherId: foreign.id }] })).status, 409);
      const save = await invoke(POST, path, users[0], draft); assert.equal(save.status, 200, await save.clone().text());
      const revision = (await save.json()).updatedAt;
      assert.equal((await invoke(exportReport, `${path}/export?date=2026-09-15`, users[0])).status, 409);
      assert.equal((await invoke(POST, path, users[0], draft)).status, 409, 'stale saves cannot overwrite');
      const checked = { ...draft, internalShort: 0, internalLong: 1, reviewed: true, expectedUpdatedAt: revision };
      const approve = await invoke(POST, path, users[0], checked); assert.equal(approve.status, 200, await approve.clone().text());
      await db.teacher.update({ where: { id: owned.id }, data: { maxWeeklyHours: 8, status: 'LEAVE' } });
      const exportResponse = await invoke(exportReport, `${path}/export?date=2026-09-15`, users[0]);
      assert.equal(exportResponse.status, 200); assert.equal(exportResponse.headers.get('cache-control'), 'private, no-store');
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await exportResponse.arrayBuffer());
      assert.equal(workbook.worksheets[0].getCell('D8').value, 15, 'saved snapshot survives changed source data');
      assert.equal((await invoke(exportReport, `${path}/export?date=2026-09-15&revision=stale`, users[0])).status, 409);
      assert.equal((await invoke(exportReport, `${path}/export?date=2026-09-15`, users[1])).status, 404);
      const october = await (await invoke(GET, `${path}?date=2026-10-01`, users[0])).json();
      assert.equal(october.rows[0].setting.weeklyHours, 15);
      const exclude = { ...draft, date: '2026-10-01', entries: [{ ...draft.entries[0], setting: { ...draft.entries[0].setting, effectiveFrom: '2026-10-01', included: false } }] };
      assert.equal((await invoke(POST, path, users[0], exclude)).status, 200);
      const historic = await (await invoke(GET, `${path}?date=2026-09-30`, users[0])).json();
      assert.equal(historic.rows[0].setting.included, true);
      const later = await (await invoke(GET, `${path}?date=2026-10-15`, users[0])).json();
      assert.equal(later.rows[0].setting.included, false);
      const backup = await generateBackupData(users[0]);
      assert.equal(backup.data.governmentReports.length, 2);
      assert.equal(backup.data.reportingPeriods.length, 2);
      assert.ok(backup.data.reportingPeriods.every(p => p.teacherId === owned.id));
      const { POST: importBackup } = await import('../src/app/api/backup/import/route');
      const restored = await invoke(importBackup, '/api/backup/import', users[0], backup);
      assert.equal(restored.status, 200, await restored.clone().text());
      assert.equal(await db.reserveReportingPeriod.count({ where: { teacherId: owned.id } }), 2);
      assert.equal(await db.governmentReport.count({ where: { schulamtId: users[0] } }), 2);
      const afterRestore = await invoke(exportReport, `${path}/export?date=2026-09-15`, users[0]);
      assert.equal(afterRestore.status, 200);
    } finally {
      await db.teacher.deleteMany({ where: { stammschuleId: { in: schools } } });
      await db.school.deleteMany({ where: { id: { in: schools } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  });
}
