import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { getNextOpenRequestDate } from '../src/lib/requestDays';
import { getSchoolYearForDate } from '../src/lib/schoolYear';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  test('reserve shortage integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'shortage-integration-test-secret';
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
  const db = new PrismaClient({ datasources: { db: { url } } });

  test('central policy, manual availability, batch approval, sickness, school email and backup roundtrip', async t => {
    const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
    t.after(() => hook.deregister());
    const { POST: assign } = await import('../src/app/api/assign/route');
    const { GET: match } = await import('../src/app/api/match/[requestId]/route');
    const { POST: preview } = await import('../src/app/api/batch-assign/preview/route');
    const { POST: approve } = await import('../src/app/api/batch-assign/approve/route');
    const { POST: absence } = await import('../src/app/api/teachers/absence/route');
    const { POST: saveProfile, GET: getProfile } = await import('../src/app/api/schulamt/profile/route');
    const { POST: restore } = await import('../src/app/api/backup/import/route');
    const { generateBackupData } = await import('../src/lib/backup');
    const { revealSecret } = await import('../src/lib/secrets');
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const invoke = async (handler: (req: Request) => Promise<Response>, userId: string, method = 'GET', body?: unknown) => {
      const pathname = '/api/shortage-test';
      const req = new Request(`http://localhost${pathname}`, {
        method, headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const store = createRequestStoreForAPI(req as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(req)));
    };
    const ok = async (response: Response) => {
      const body = await response.json();
      assert.ok(response.ok, `${response.status}: ${JSON.stringify(body)}`);
      return body;
    };
    const office = await db.user.create({ data: { email: `${crypto.randomUUID()}@shortage.test`, password: 'test', role: 'SCHULAMT' } });
    const school = await db.school.create({ data: { name: 'Testschule', address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: office.id, latitude: 48, longitude: 11 } });
    const schoolUser = await db.user.create({ data: { email: `${crypto.randomUUID()}@shortage.test`, password: 'test', role: 'SCHOOL', schoolId: school.id } });
    const teacherUser = await db.user.create({ data: { email: `${crypto.randomUUID()}@shortage.test`, password: 'test', role: 'TEACHER' } });
    const monday = new Date(); monday.setHours(12, 0, 0, 0); monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    const dates = Array.from({ length: 5 }, (_, offset) => {
      const day = new Date(monday); day.setDate(day.getDate() + offset); return day.toISOString().slice(0, 10);
    });
    const schoolYear = getSchoolYearForDate(monday);
    const teacher = await db.teacher.create({ data: {
      userId: teacherUser.id, name: 'Teilzeitreserve', stammschuleId: school.id, schoolYear, status: 'ACTIVE',
      isPartTime: true, schedule: JSON.stringify({ 1: [1, 2, 3, 4], 2: [1, 2, 3, 4], 3: [1, 2, 3, 4] }),
      postalCode: '80331', maxWeeklyHours: 20, qualifications: 'Alles', preferredType: 'BOTH', homeLat: 48, homeLng: 11,
    } });
    const request = await db.request.create({ data: {
      schoolId: school.id, date: new Date(dates[0]), endDate: new Date(dates[4]),
      hours: 6, weeklyHours: 30, startHour: 1, status: 'PENDING', substitutedTeacher: 'Test', qualifications: '',
    } });
    const profileInput = {
      headerText: 'Test', returnAddress: 'Test', contactAddress: 'Test', contactPerson: 'Test', city: 'Test',
      amtsleitungName: 'Test', amtsleitungTitle: 'Test', documentSubject: 'Test', documentIntro: 'Test', documentClosing: 'Test', mailProvider: 'NONE',
    };
    const loadMatch = () => invoke(req => match(req, { params: Promise.resolve({ requestId: request.id }) }), office.id);
    const loadRequest = () => db.request.findUniqueOrThrow({ where: { id: request.id }, include: { assignments: true } });
    try {
      assert.equal((await ok(await invoke(getProfile, office.id))).reserveShortageMode, false);
      assert.equal((await invoke(saveProfile, schoolUser.id, 'POST', { ...profileInput, reserveShortageMode: true })).status, 403);
      assert.equal((await invoke(saveProfile, office.id, 'POST', { ...profileInput, reserveShortageMode: 'true' })).status, 400);
      await ok(await invoke(saveProfile, office.id, 'POST', { ...profileInput, reserveShortageMode: true }));
      await ok(await invoke(saveProfile, office.id, 'POST', profileInput));
      assert.equal((await ok(await invoke(getProfile, office.id))).reserveShortageMode, true, 'older clients preserve the saved setting');
      // Persist notifications, but never deliver externally in this test.
      await db.schulamtProfile.update({ where: { userId: office.id }, data: { mailProvider: 'SMTP' } });
      const candidates = await ok(await loadMatch());
      assert.deepEqual(candidates.candidates[0].eligibleDateKeys, dates.slice(0, 3));
      assert.deepEqual(candidates.manualCandidates[0].eligibleDateKeys, dates);
      assert.equal(candidates.reserveShortageMode, true);

      const plan = await ok(await invoke(preview, office.id, 'POST', { schoolYear, until: dates[4] }));
      assert.equal(plan.reserveShortageMode, true);
      const proposedSchool = plan.schools.find((item: { schoolId: string }) => item.schoolId === school.id);
      assert.equal(proposedSchool.coverage.cancelledHours, 6, JSON.stringify(proposedSchool));
      const items = proposedSchool.proposals.map((item: { requestId: string; segments: { teacherId: string; entries: { date: string; hours: number }[] }[] }) => ({
        requestId: item.requestId, segments: item.segments.map(segment => ({ teacherId: segment.teacherId, entries: segment.entries })),
      }));
      await ok(await invoke(approve, office.id, 'POST', { schoolYear, until: dates[4], schoolId: school.id, items, expectedReserveShortageMode: true }));
      let stored = await loadRequest();
      assert.equal(stored.status, 'PARTIALLY_FILLED');
      assert.equal(getNextOpenRequestDate(stored, stored.assignments), dates[3]);
      assert.deepEqual(stored.assignments.map(row => [row.hours, row.cancelledHours]), [[4, 2], [4, 2], [4, 2]]);
      await db.request.update({ where: { id: request.id }, data: { status: 'FILLED' } });
      const reopenedPlan = await ok(await invoke(preview, office.id, 'POST', { schoolYear, until: dates[4] }));
      assert.equal(reopenedPlan.requestsById[request.id].status, 'PARTIALLY_FILLED', 'a legacy filled status must not hide the remaining days');
      const messages = (await db.emailOutbox.findMany({ where: { schulamtId: office.id } })).map(row => JSON.parse(revealSecret(row.payloadEncrypted!)));
      const schoolMail = messages.find(mail => mail.to === schoolUser.email);
      assert.ok(schoolMail);
      assert.match(schoolMail.body, /2 Stunde\(n\) abgesagt/);
      assert.match(schoolMail.body, /Mangel an Reserven/);

      const manualInput = { requestId: request.id, teacherId: teacher.id, assignments: [{ date: dates[3], hours: 4 }], expectedReserveShortageMode: true };
      assert.equal((await invoke(assign, office.id, 'POST', manualInput)).status, 409, 'non-working Thursday requires manual consent');
      await ok(await invoke(assign, office.id, 'POST', { ...manualInput, allowTimetableOverride: true }));
      await ok(await invoke(absence, teacherUser.id, 'POST', { date: dates[0], reason: 'Ungeplanter Ausfall' }));
      stored = await loadRequest();
      assert.equal(getNextOpenRequestDate(stored, stored.assignments), dates[0]);
      const afterAbsence = await ok(await loadMatch());
      assert.equal(afterAbsence.candidates.length, 0);
      assert.deepEqual(afterAbsence.manualCandidates[0].eligibleDateKeys, [dates[4]]);
      assert.equal((await invoke(assign, office.id, 'POST', { ...manualInput, assignments: [{ date: dates[0], hours: 4 }], allowTimetableOverride: true })).status, 409);

      await db.schulamtProfile.update({ where: { userId: office.id }, data: { reserveShortageMode: false } });
      assert.equal((await invoke(assign, office.id, 'POST', { ...manualInput, assignments: [{ date: dates[4], hours: 4 }], allowTimetableOverride: true })).status, 409, 'stale policy cannot silently change the operation');
      await ok(await invoke(assign, office.id, 'POST', { ...manualInput, assignments: [{ date: dates[4], hours: 4 }], allowTimetableOverride: true, expectedReserveShortageMode: false }));
      assert.equal((await loadRequest()).assignments.find(row => row.date.toISOString().slice(0, 10) === dates[4])?.cancelledHours, 0);

      await db.schulamtProfile.update({ where: { userId: office.id }, data: { reserveShortageMode: true } });
      const backup = await generateBackupData(office.id);
      assert.equal(backup.data.profile?.reserveShortageMode, true);
      assert.equal(backup.data.assignments.filter(row => row.cancelledHours === 2).length, 4);
      await ok(await invoke(restore, office.id, 'POST', backup));
      assert.equal((await loadRequest()).assignments.filter(row => row.cancelledHours === 2).length, 4);
      assert.equal((await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } })).reserveShortageMode, true);
      delete (backup.data.profile as { reserveShortageMode?: boolean }).reserveShortageMode;
      for (const assignment of backup.data.assignments) delete (assignment as { cancelledHours?: number }).cancelledHours;
      await ok(await invoke(restore, office.id, 'POST', backup));
      assert.equal((await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } })).reserveShortageMode, false, 'legacy backups do not enable the policy');
      assert.ok((await loadRequest()).assignments.every(row => row.cancelledHours === 0), 'legacy backups do not invent cancellations');
    } finally {
      await db.assignment.deleteMany({ where: { requestId: request.id } });
      await db.request.deleteMany({ where: { schoolId: school.id } });
      await db.absence.deleteMany({ where: { teacherId: teacher.id } });
      await db.teacher.deleteMany({ where: { stammschuleId: school.id } });
      await db.user.deleteMany({ where: { id: { in: [schoolUser.id, teacherUser.id] } } });
      await db.school.delete({ where: { id: school.id } });
      await db.emailOutbox.deleteMany({ where: { schulamtId: office.id } });
      await db.user.delete({ where: { id: office.id } });
      await db.$disconnect();
    }
  });
}
