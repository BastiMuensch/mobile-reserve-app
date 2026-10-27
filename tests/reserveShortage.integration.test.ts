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
    const { POST: saveProfile, PATCH: savePreferences, GET: getProfile } = await import('../src/app/api/schulamt/profile/route');
    const { POST: restore } = await import('../src/app/api/backup/import/route');
    const { GET: teacherAssignments } = await import('../src/app/api/teachers/[id]/assignments/route');
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
      isPartTime: true, schedule: JSON.stringify({ 1: [3, 4, 5, 6], 2: [3, 4, 5, 6], 3: [3, 4, 5, 6] }),
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
      assert.equal((await ok(await invoke(getProfile, office.id))).schoolDistrictFilterEnabled, false);
      const districtPreferences = { requestUrgencyNoteEnabled: false, reserveShortageMode: false, schoolDistrictFilterEnabled: true };
      assert.equal((await invoke(savePreferences, schoolUser.id, 'PATCH', districtPreferences)).status, 403);
      assert.equal((await invoke(savePreferences, office.id, 'PATCH', { ...districtPreferences, schoolDistrictFilterEnabled: 'true' })).status, 400);
      await ok(await invoke(savePreferences, office.id, 'PATCH', districtPreferences));
      assert.equal((await ok(await invoke(getProfile, office.id))).schoolDistrictFilterEnabled, true);
      await ok(await invoke(savePreferences, office.id, 'PATCH', { ...districtPreferences, schoolDistrictFilterEnabled: false }));
      assert.equal((await ok(await invoke(getProfile, office.id))).schoolDistrictFilterEnabled, false);
      await ok(await invoke(savePreferences, office.id, 'PATCH', districtPreferences));

      await ok(await invoke(savePreferences, office.id, 'PATCH', { section: 'notifications', values: { mailProvider: 'NONE', teacherInviteValidityDays: 28 } }));
      const emptyDocumentProfile = await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } });
      assert.equal(emptyDocumentProfile.headerText, '', 'notifications can be configured before completing documents');
      assert.equal(emptyDocumentProfile.teacherInviteValidityDays, 28);
      assert.equal((await invoke(savePreferences, office.id, 'PATCH', { section: 'notifications', values: { mailProvider: 'NONE', headerText: 'must not write' } })).status, 400);
      assert.equal((await invoke(saveProfile, schoolUser.id, 'POST', { ...profileInput, reserveShortageMode: true })).status, 403);
      assert.equal((await invoke(saveProfile, office.id, 'POST', { ...profileInput, reserveShortageMode: 'true' })).status, 400);
      await ok(await invoke(saveProfile, office.id, 'POST', { ...profileInput, reserveShortageMode: true }));
      await ok(await invoke(saveProfile, office.id, 'POST', profileInput));
      assert.equal((await ok(await invoke(getProfile, office.id))).reserveShortageMode, true, 'older clients preserve the saved setting');
      const beforePreferences = await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } });
      assert.equal((await invoke(savePreferences, schoolUser.id, 'PATCH', { requestUrgencyNoteEnabled: true, reserveShortageMode: false })).status, 403);
      assert.equal((await invoke(savePreferences, office.id, 'PATCH', { requestUrgencyNoteEnabled: true, reserveShortageMode: 'false' })).status, 400);
      assert.equal((await invoke(savePreferences, office.id, 'PATCH', { requestUrgencyNoteEnabled: true, reserveShortageMode: false, headerText: 'Must not change' })).status, 400);
      await ok(await invoke(savePreferences, office.id, 'PATCH', { requestUrgencyNoteEnabled: true, reserveShortageMode: true }));
      const afterPreferences = await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } });
      assert.equal(afterPreferences.requestUrgencyNoteEnabled, true);
      assert.equal(afterPreferences.schoolDistrictFilterEnabled, true, 'older clients preserve explicit district opt-in');
      for (const key of ['headerText', 'logoUrl', 'signatureUrl', 'mailProvider', 'smtpHost', 'smtpPass'] as const) assert.equal(afterPreferences[key], beforePreferences[key]);
      const smtpValues = { mailProvider: 'SMTP', smtpHost: 'smtp.example.test', smtpUser: 'test-user', smtpPass: 'test-secret', smtpFromName: 'Testamt', smtpFromAddress: 'office@example.test', teacherInviteValidityDays: 21 };
      await ok(await invoke(savePreferences, office.id, 'PATCH', { section: 'notifications', values: smtpValues }));
      const mailProfile = await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } });
      const documentValues = Object.fromEntries(Object.entries(profileInput).filter(([key]) => key !== 'mailProvider'));
      await ok(await invoke(savePreferences, office.id, 'PATCH', { section: 'documents', values: { ...documentValues, headerText: 'Neuer Briefkopf' } }));
      const documentProfile = await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } });
      assert.equal(documentProfile.headerText, 'Neuer Briefkopf');
      for (const key of ['smtpHost', 'smtpPass', 'mailProvider', 'teacherInviteValidityDays', 'reserveShortageMode', 'requestUrgencyNoteEnabled'] as const) assert.equal(documentProfile[key], mailProfile[key], `documents must preserve ${key}`);
      assert.equal((await invoke(savePreferences, office.id, 'PATCH', { section: 'notifications', values: { ...smtpValues, smtpHost: 'changed.example.test', smtpPass: '********' } })).status, 400, 'masked passwords cannot be reused for a changed SMTP destination');
      await ok(await invoke(savePreferences, office.id, 'PATCH', { section: 'notifications', values: { ...smtpValues, smtpPass: '********', teacherInviteValidityDays: 22 } }));
      assert.equal((await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } })).headerText, 'Neuer Briefkopf');
      assert.equal((await invoke(savePreferences, office.id, 'PATCH', { section: 'documents', values: { ...documentValues, latitude: 48 } })).status, 400);
      assert.equal((await invoke(savePreferences, office.id, 'PATCH', { section: 'documents', values: { ...documentValues, logoUrl: '/uploads/12345678-abcd.png' } })).status, 400);
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
      assert.ok(stored.assignments.every(row => row.lessonHours === '[3,4,5,6]'), 'batch approval snapshots actual partial lesson slots');
      await db.teacher.update({ where: { id: teacher.id }, data: { schedule: JSON.stringify({ 1: [1, 2, 3, 4], 2: [1, 2, 3, 4], 3: [1, 2, 3, 4] }) } });
      const history = await ok(await invoke(req => teacherAssignments(req, { params: Promise.resolve({ id: teacher.id }) }), teacherUser.id));
      assert.ok(history.every((row: { lessonHours: string }) => row.lessonHours === '[3,4,5,6]'), 'teacher API preserves assigned lessons after the timetable changes');
      await db.request.update({ where: { id: request.id }, data: { status: 'FILLED' } });
      const reopenedPlan = await ok(await invoke(preview, office.id, 'POST', { schoolYear, until: dates[4] }));
      assert.equal(reopenedPlan.requestsById[request.id].status, 'PARTIALLY_FILLED', 'a legacy filled status must not hide the remaining days');
      const messages = (await db.emailOutbox.findMany({ where: { schulamtId: office.id } })).map(row => JSON.parse(revealSecret(row.payloadEncrypted!)));
      const schoolMail = messages.find(mail => mail.to === schoolUser.email);
      assert.ok(schoolMail);
      assert.match(schoolMail.body, /2 Stunde\(n\) abgesagt/);
      assert.match(schoolMail.body, /Mangel an Reserven/);
      assert.match(schoolMail.body, /Beginn: 3\. Stunde/);
      const teacherMail = messages.find(mail => mail.to === teacherUser.email);
      assert.match(teacherMail.body, /Beginn: 3\. Stunde/);
      assert.match(teacherMail.attachments[0].content, /DTSTART;VALUE=DATE:/);
      assert.doesNotMatch(teacherMail.attachments[0].content, /DTSTART:|DTEND:/);

      const manualInput = { requestId: request.id, teacherId: teacher.id, assignments: [{ date: dates[3], hours: 4 }], expectedReserveShortageMode: true };
      assert.equal((await invoke(assign, office.id, 'POST', manualInput)).status, 409, 'non-working Thursday requires manual consent');
      await ok(await invoke(assign, office.id, 'POST', { ...manualInput, allowTimetableOverride: true }));
      assert.equal((await loadRequest()).assignments.find(row => row.date.toISOString().slice(0, 10) === dates[3])?.lessonHours, '[1,2,3,4]', 'explicit non-working-day exception stores selected request lessons');
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
      assert.equal(backup.data.profile?.schoolDistrictFilterEnabled, true);
      assert.equal(backup.data.assignments.filter(row => row.cancelledHours === 2).length, 4);
      const originalSlots = backup.data.assignments.map(row => [row.id, row.lessonHours]).sort();
      await ok(await invoke(restore, office.id, 'POST', backup));
      assert.equal((await loadRequest()).assignments.filter(row => row.cancelledHours === 2).length, 4);
      assert.deepEqual((await loadRequest()).assignments.map(row => [row.id, row.lessonHours]).sort(), originalSlots, 'backup roundtrip retains original lesson snapshots');
      assert.equal((await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } })).reserveShortageMode, true);
      assert.equal((await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } })).schoolDistrictFilterEnabled, true);
      delete (backup.data.profile as { schoolDistrictFilterEnabled?: boolean }).schoolDistrictFilterEnabled;
      delete (backup.data.profile as { reserveShortageMode?: boolean }).reserveShortageMode;
      for (const assignment of backup.data.assignments) {
        delete (assignment as { cancelledHours?: number }).cancelledHours;
        delete (assignment as { lessonHours?: string | null }).lessonHours;
      }
      await ok(await invoke(restore, office.id, 'POST', backup));
      assert.equal((await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } })).reserveShortageMode, false, 'legacy backups do not enable the policy');
      assert.equal((await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } })).schoolDistrictFilterEnabled, false);
      assert.ok((await loadRequest()).assignments.every(row => row.cancelledHours === 0), 'legacy backups do not invent cancellations');
      assert.ok((await loadRequest()).assignments.every(row => row.lessonHours === null), 'legacy backups do not invent lesson slots');
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
