import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getOpenRequestDays } from '../src/lib/requestDays';
import { toLocalDateInputValue, toCanonicalUtcDate } from '../src/lib/dateKey';
import { getSchoolYearForDate } from '../src/lib/schoolYear';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  test('return dates and teacher timetable validation', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'return-timetable-integration-test-secret';
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 34).toString('base64');
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
  const db = new PrismaClient({ datasourceUrl: url });
  const hook = registerHooks({
    resolve: (specifier, context, next) =>
      next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context),
  });
  test.after(async () => { hook.deregister(); await db.$disconnect(); });

  async function invoke(userId: string, pathname: string, method: string, body: unknown, handler: (request: Request) => Promise<Response | undefined>) {
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const request = new Request(`http://localhost${pathname}`, {
      method, headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`, 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
    const response = await workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never,
      () => workUnitAsyncStorage.run(store, () => handler(request)));
    assert.ok(response);
    return response;
  }

  async function fixture(t: test.TestContext) {
    const office = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, password: 'hash', role: 'SCHULAMT' } });
    const school = await db.school.create({ data: { name: 'Testschule', address: 'Testweg 1', type: 'GRUNDSCHULE', latitude: 48, longitude: 11, schulamtId: office.id } });
    t.after(async () => {
      await db.assignment.deleteMany({ where: { request: { schoolId: school.id } } });
      await db.request.deleteMany({ where: { schoolId: school.id } });
      await db.teacher.deleteMany({ where: { stammschuleId: school.id } });
      await db.teacherInvitation.deleteMany({ where: { schulamtId: office.id } });
      await db.emailOutbox.deleteMany({ where: { schulamtId: office.id } });
      await db.school.delete({ where: { id: school.id } });
      await db.user.delete({ where: { id: office.id } });
    });
    return { office, school };
  }

  test('return route preserves future last days and never reopens days after a backdated return', async t => {
    const { office, school } = await fixture(t);
    const { PATCH } = await import('../src/app/api/requests/[id]/end/route');
    const { validateAndCreateAssignments } = await import('../src/lib/assignService');
    const { buildCompletedRequestFilter } = await import('../src/lib/dataRetention');
    const today = toCanonicalUtcDate(new Date());
    const monday = new Date(today);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const day = (offset: number) => new Date(monday.getTime() + offset * 86400000);
    const teacher = await db.teacher.create({ data: {
      name: 'Reserve', stammschuleId: school.id, status: 'ACTIVE', maxWeeklyHours: 28,
      schoolYear: getSchoolYearForDate(day(11)), qualifications: '', homeLat: 48, homeLng: 11, preferredType: 'BOTH',
    } });
    for (const offset of [11, -3]) {
      const lastDay = day(offset);
      const req = await db.request.create({ data: {
        schoolId: school.id, date: day(-14), isOpenEnded: true, hours: 1,
        schedule: JSON.stringify({ 1: [1], 2: [1], 3: [1], 4: [1], 5: [1] }),
        substitutedTeacher: 'Test', qualifications: '', status: 'PENDING',
      } });
      const response = await invoke(office.id, `/api/requests/${req.id}/end`, 'PATCH',
        { lastDay: toLocalDateInputValue(lastDay) }, request => PATCH(request, { params: Promise.resolve({ id: req.id }) }));
      assert.equal(response.status, 200, await response.text());
      const saved = await db.request.findUniqueOrThrow({ where: { id: req.id } });
      assert.equal(saved.endDate?.getTime(), lastDay.getTime());
      assert.ok(saved.endedAt && Math.abs(saved.endedAt.getTime() - Date.now()) < 60_000);
      const open = getOpenRequestDays(saved);
      assert.equal(open.at(-1)?.date, toLocalDateInputValue(lastDay));
      if (offset > 0) {
        await db.$transaction(tx => validateAndCreateAssignments(tx, {
          requestId: req.id, teacherId: teacher.id, schulamtId: office.id,
          entries: [{ date: toLocalDateInputValue(lastDay), hours: 1 }],
        }));
      }
    }
    const old = new Date(today.getTime() - 40 * 86400000);
    const cutoff = new Date(today.getTime() - 30 * 86400000);
    const fields = { schoolId: school.id, date: old, hours: 1, substitutedTeacher: 'Test', qualifications: '', status: 'PENDING' };
    const upcoming = await db.request.create({ data: { ...fields, isOpenEnded: true, endDate: day(11), endedAt: old } });
    const completed = await db.request.create({ data: { ...fields, endDate: old, endedAt: today } });
    const expired = await db.request.findMany({ where: { schoolId: school.id, ...buildCompletedRequestFilter(cutoff) }, select: { id: true } });
    assert.ok(expired.some(row => row.id === completed.id));
    assert.ok(!expired.some(row => row.id === upcoming.id));
  });

  test('create, edit and invitation registration reject malformed schedules before writes; legacy data cannot break matching', async t => {
    const { office, school } = await fixture(t);
    const { POST } = await import('../src/app/api/teachers/route');
    const { PATCH } = await import('../src/app/api/teachers/[id]/route');
    const { POST: register } = await import('../src/app/api/setup/register-teacher/route');
    const { GET: match } = await import('../src/app/api/match/[requestId]/route');
    const { createInvitationToken, hashInvitationToken } = await import('../src/lib/teacherInvitations');
    const form = { name: 'Reserve', stammschuleId: school.id, maxWeeklyHours: 20, isPartTime: true,
      schedule: { 2: [3, 4] }, qualifications: '', qualificationType: 'TEACHER_GS', canTeachSports: false,
      address: 'Testweg 2', postalCode: '80331', homeLat: 48, homeLng: 11, preferredType: 'BOTH', schoolYear: '2026/2027' };
    const bad = { 2: 42 };
    const created = await invoke(office.id, '/api/teachers', 'POST', { ...form, schedule: bad }, POST);
    assert.equal(created.status, 400);
    assert.equal(await db.teacher.count({ where: { stammschuleId: school.id } }), 0);
    const valid = await invoke(office.id, '/api/teachers', 'POST', form, POST);
    assert.equal(valid.status, 201, await valid.clone().text());
    const teacher = await valid.json();
    const patch = (body: unknown) => invoke(office.id, `/api/teachers/${teacher.id}`, 'PATCH', body,
      request => PATCH(request, { params: Promise.resolve({ id: teacher.id }) }));
    assert.equal((await patch({ schedule: bad })).status, 400);
    assert.equal((await db.teacher.findUniqueOrThrow({ where: { id: teacher.id } })).schedule, JSON.stringify(form.schedule));
    assert.equal((await patch({ schedule: { 2: [4] } })).status, 200);
    const { schedule: omitted, ...fullForm } = form;
    void omitted;
    assert.equal((await patch(fullForm)).status, 200);
    assert.equal((await db.teacher.findUniqueOrThrow({ where: { id: teacher.id } })).schedule, '{"2":[4]}');

    const token = createInvitationToken();
    const email = `${randomUUID()}@example.invalid`;
    const invitation = await db.teacherInvitation.create({ data: {
      schulamtId: office.id, recipientEmail: email, tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + 60_000),
    } });
    const registration = await register(new Request('http://localhost/api/setup/register-teacher', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '127.0.0.35' },
      body: JSON.stringify({ ...form, token, email, password: 'Schedule-Regression-2026!', qualifications: 'Deutsch', schedule: bad }),
    }));
    assert.equal(registration.status, 400);
    assert.equal((await db.teacherInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).completedAt, null);
    assert.equal(await db.user.findUnique({ where: { email } }), null);
    // Imported pre-validation data is deliberately malformed here.
    await db.teacher.update({ where: { id: teacher.id }, data: { schedule: JSON.stringify(bad) } });
    const req = await db.request.create({ data: {
      schoolId: school.id, date: new Date('2026-10-20'), hours: 4, substitutedTeacher: 'Test', qualifications: '', status: 'PENDING',
    } });
    const matched = await invoke(office.id, `/api/match/${req.id}`, 'GET', undefined,
      request => match(request, { params: Promise.resolve({ requestId: req.id }) }));
    assert.equal(matched.status, 200, await matched.text());
  });
}
