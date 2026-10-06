import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  test('privacy retention and absence portal', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'privacy-integration-test-secret';
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  delete process.env.SMTP_HOST;
  const db = new PrismaClient({ datasources: { db: { url } } });
  test('absence reasons stay in the authorized portal; cleanup protects current and referenced profiles', async t => {
    const hooks = registerHooks({
      resolve(specifier, context, next) {
        return next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
      },
    });
    t.after(() => hooks.deregister());
    const { POST } = await import('../src/app/api/teachers/absence/route');
    const { GET } = await import('../src/app/api/teachers/route');
    const { signToken } = await import('../src/lib/auth');
    const { runGdprCleanup } = await import('../src/lib/dataRetention');
    const { getCurrentSchoolYear } = await import('../src/lib/schoolYear');
    const { toCanonicalUtcDate, toLocalDateInputValue } = await import('../src/lib/dateKey');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const ids: string[] = [];
    const user = async (role: string) => {
      const row = await db.user.create({ data: { email: `${randomUUID()}@privacy.test`, password: 'test', role } });
      ids.push(row.id); return row;
    };
    const office = await user('SCHULAMT');
    const outsider = await user('SCHULAMT');
    const login = await user('TEACHER');
    const expiredLogin = await user('TEACHER');
    const school = await db.school.create({ data: { name: 'Privacy test', address: 'Test', type: 'GRUNDSCHULE', schulamtId: office.id } });
    const profile = (schoolYear: string, userId?: string) => db.teacher.create({ data: {
      name: 'Reserve', stammschuleId: school.id, userId, schoolYear, maxWeeklyHours: 28,
      qualifications: 'Alles', status: 'ACTIVE', homeLat: 48, homeLng: 11, preferredType: 'BOTH',
    } });
    const current = await profile(getCurrentSchoolYear(), login.id);
    const expired = await profile('2000/2001', login.id);
    const departed = await profile('2000/2001', expiredLogin.id);
    const withAssignment = await profile('2000/2001');
    const withLeave = await profile('2000/2001');
    const withAbsence = await profile('2000/2001');
    const malformed = await profile('bad-year');
    const today = toCanonicalUtcDate(new Date());
    const tomorrow = new Date(today); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const old = new Date('2001-06-01T00:00:00Z');
    const req = await db.request.create({ data: { schoolId: school.id, date: today, isOpenEnded: true, hours: 1, substitutedTeacher: 'Test', qualifications: '', status: 'PENDING' } });
    await db.assignment.create({ data: { requestId: req.id, teacherId: withAssignment.id, date: today, hours: 1 } });
    await db.leavePeriod.create({ data: { teacherId: withLeave.id, startDate: old, endDate: null, reportedBy: 'SCHULAMT' } });
    await db.absence.create({ data: { teacherId: withAbsence.id, date: tomorrow, type: 'UNAVAILABLE', reason: 'Future' } });
    await db.reserveReportingPeriod.create({ data: { teacherId: expired.id, effectiveFrom: old, category: 'GS_MS', weeklyHours: 28 } });
    const oldReport = await db.governmentReport.create({ data: { schulamtId: office.id, date: old, payload: { teacherId: expired.id } } });
    const recentReport = await db.governmentReport.create({ data: { schulamtId: office.id, date: today, payload: {} } });
    const expiredToken = await db.passwordResetToken.create({ data: { userId: login.id, tokenHash: randomUUID(), expiresAt: old } });
    const validToken = await db.passwordResetToken.create({ data: { userId: login.id, tokenHash: randomUUID(), expiresAt: tomorrow } });
    const expiredInvitation = await db.teacherInvitation.create({ data: { schulamtId: office.id, recipientEmail: 'old@test.invalid', tokenHash: randomUUID(), expiresAt: old } });
    const validInvitation = await db.teacherInvitation.create({ data: { schulamtId: office.id, recipientEmail: 'new@test.invalid', tokenHash: randomUUID(), expiresAt: tomorrow } });
    const invoke = async (userId: string, method: 'GET' | 'POST', body?: object) => {
      const path = method === 'GET' ? '/api/teachers' : '/api/teachers/absence';
      const request = new Request(`http://localhost${path}`, { method, headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const store = createRequestStoreForAPI(request as never, { pathname: path, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: path, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => method === 'GET' ? GET(request) : POST(request)));
    };
    try {
      const reason = 'Nur im Portal sichtbare Planungsinformation';
      assert.equal((await invoke(login.id, 'POST', { date: tomorrow.toISOString().slice(0, 10), reason })).status, 200);
      const queued = await db.emailOutbox.findFirstOrThrow({ where: { schulamtId: office.id } });
      const { revealSecret } = await import('../src/lib/secrets');
      const mail = JSON.parse(revealSecret(queued.payloadEncrypted!)) as { body: string };
      assert.ok(mail.body.includes('Mobile Reserven'));
      assert.ok(!mail.body.includes(reason));
      const rows = await (await invoke(office.id, 'GET')).json();
      const visible = rows.find((row: { id: string }) => row.id === current.id);
      assert.equal(visible.absences[0].reason, reason);
      assert.equal(visible.isAbsentToday, false, 'future absence must not mark today absent');
      assert.equal((await invoke(login.id, 'GET')).status, 403);
      assert.deepEqual(await (await invoke(outsider.id, 'GET')).json(), []);
      assert.equal((await invoke(login.id, 'POST', { date: toLocalDateInputValue(), reason })).status, 200);
      assert.equal((await (await invoke(office.id, 'GET')).json()).find((row: { id: string }) => row.id === current.id).isAbsentToday, true);
      const result = await runGdprCleanup();
      assert.ok(result.stats.deletedTeacherProfiles >= 2);
      assert.equal(await db.teacher.count({ where: { id: { in: [expired.id, departed.id] } } }), 0);
      assert.equal(await db.teacher.count({ where: { id: { in: [current.id, withAssignment.id, withLeave.id, withAbsence.id, malformed.id] } } }), 5);
      assert.equal(await db.reserveReportingPeriod.count({ where: { teacherId: expired.id } }), 0);
      assert.ok(await db.user.findUnique({ where: { id: login.id } }));
      assert.equal(await db.user.findUnique({ where: { id: expiredLogin.id } }), null);
      assert.equal(await db.governmentReport.findUnique({ where: { id: oldReport.id } }), null);
      assert.ok(await db.governmentReport.findUnique({ where: { id: recentReport.id } }));
      assert.equal(await db.passwordResetToken.findUnique({ where: { id: expiredToken.id } }), null);
      assert.ok(await db.passwordResetToken.findUnique({ where: { id: validToken.id } }));
      assert.equal(await db.teacherInvitation.findUnique({ where: { id: expiredInvitation.id } }), null);
      assert.ok(await db.teacherInvitation.findUnique({ where: { id: validInvitation.id } }));
      const second = await runGdprCleanup();
      assert.equal(second.stats.deletedTeacherProfiles, 0);
    } finally {
      await db.emailOutbox.deleteMany({ where: { schulamtId: office.id } });
      await db.assignment.deleteMany({ where: { requestId: req.id } });
      await db.request.delete({ where: { id: req.id } });
      await db.absence.deleteMany({ where: { teacher: { stammschuleId: school.id } } });
      await db.teacher.deleteMany({ where: { stammschuleId: school.id } });
      await db.school.delete({ where: { id: school.id } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect();
      const { prisma } = await import('../src/lib/prisma'); await prisma.$disconnect();
    }
  });
}
