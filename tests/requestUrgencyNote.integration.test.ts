import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { PrismaClient } from '@prisma/client';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  test('private request urgency note integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'urgency-integration-test-secret';
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString('base64');
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  const db = new PrismaClient({ datasources: { db: { url } } });

  test('activation, persistence, role isolation, notifications, backup and retention of urgency notes', async t => {
    const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
    t.after(() => hook.deregister());
    const { POST, GET } = await import('../src/app/api/requests/route');
    const { GET: assignments } = await import('../src/app/api/teachers/[id]/assignments/route');
    const { PATCH: confirm } = await import('../src/app/api/assignments/[id]/status/route');
    const { POST: restore } = await import('../src/app/api/backup/import/route');
    const { generateBackupData } = await import('../src/lib/backup');
    const { enqueueAssignmentEmailsInTransaction } = await import('../src/lib/assignService');
    const { revealSecret } = await import('../src/lib/secrets');
    const { runGdprCleanup } = await import('../src/lib/dataRetention');
    const { signToken } = await import('../src/lib/auth');
    const { getCurrentSchoolYear } = await import('../src/lib/schoolYear');
    const { toLocalDateInputValue } = await import('../src/lib/dateKey');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const users: string[] = [];
    let schoolId: string | undefined;
    const user = async (role: string, schoolId?: string) => {
      const result = await db.user.create({ data: { email: `${randomUUID()}@urgency.test`, password: 'test', role, schoolId } });
      users.push(result.id);
      return result;
    };
    const invoke = async (handler: (req: Request) => Promise<Response>, userId: string, method: string, body?: unknown) => {
      const pathname = '/api/urgency-test';
      const request = new Request(`http://localhost${pathname}`, {
        method, headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`, 'content-type': 'application/json', 'x-forwarded-for': randomUUID() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(request)));
    };
    try {
      const office = await user('SCHULAMT');
      const foreignOffice = await user('SCHULAMT');
      const teacherUser = await user('TEACHER');
      const school = await db.school.create({ data: { name: 'Testschule Dringlichkeit', address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: office.id, generalInfo: 'Schulprofil wird weiterhin übertragen' } });
      schoolId = school.id;
      const schoolUser = await user('SCHOOL', school.id);
      await db.schulamtProfile.create({ data: { userId: office.id, mailProvider: 'NONE' } });
      const teacher = await db.teacher.create({ data: {
        name: 'Testreserve', userId: teacherUser.id, stammschuleId: school.id, schoolYear: getCurrentSchoolYear(),
        maxWeeklyHours: 28, qualifications: 'Grundschule', preferredType: 'BOTH', homeLat: 48, homeLng: 11, status: 'ACTIVE', postalCode: '80331',
      } });
      const body = { schoolId, date: toLocalDateInputValue(), startHour: 1, hours: 4, substitutedTeacher: 'Testperson', comments: 'Treffpunkt Sekretariat', idempotencyKey: randomUUID() };
      const note = 'Die Aufsicht ist ohne Vertretung nicht gesichert.';
      for (const urgencyNote of [undefined, '', ' \n ']) {
        assert.equal((await invoke(POST, schoolUser.id, 'POST', { ...body, hasUrgencyNote: true, urgencyNote })).status, 400);
      }
      assert.equal(await db.request.count({ where: { schoolId } }), 0);
      const urgentBody = { ...body, hasUrgencyNote: true, urgencyNote: `  ${note}  ` };
      const created = await invoke(POST, schoolUser.id, 'POST', urgentBody);
      assert.equal(created.status, 201);
      const saved = await created.json();
      assert.equal(saved.urgencyNote, note);
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: saved.id } })).urgencyNote, note);
      assert.equal((await (await invoke(POST, schoolUser.id, 'POST', urgentBody)).json()).idempotentReplay, true);
      assert.equal((await invoke(POST, schoolUser.id, 'POST', { ...urgentBody, urgencyNote: 'Geändert' })).status, 409);
      for (const hasUrgencyNote of [undefined, false]) {
        const disabled = await invoke(POST, schoolUser.id, 'POST', { ...body, idempotencyKey: randomUUID(), hasUrgencyNote, urgencyNote: note });
        assert.equal(disabled.status, 201);
        assert.equal((await disabled.json()).urgencyNote, null, 'inactive text must not be persisted');
      }
      assert.equal((await (await invoke(GET, office.id, 'GET')).json()).find((row: { id: string }) => row.id === saved.id).urgencyNote, note);
      assert.deepEqual(await (await invoke(GET, foreignOffice.id, 'GET')).json(), []);
      assert.equal((await invoke(GET, teacherUser.id, 'GET')).status, 401);

      const assignment = await db.assignment.create({ data: { requestId: saved.id, teacherId: teacher.id, date: new Date(body.date), hours: 4 } });
      const history = (req: Request) => assignments(req, { params: Promise.resolve({ id: teacher.id }) });
      const teacherRows = await (await invoke(history, teacherUser.id, 'GET')).json();
      assert.equal(teacherRows[0].request.comments, body.comments);
      assert.equal(teacherRows[0].request.school.generalInfo, school.generalInfo);
      assert.equal(Object.hasOwn(teacherRows[0].request, 'urgencyNote'), false);
      assert.ok(!JSON.stringify(teacherRows).includes(note));
      assert.equal((await (await invoke(history, office.id, 'GET')).json())[0].request.urgencyNote, note);
      assert.equal((await invoke(history, foreignOffice.id, 'GET')).status, 403);
      const confirmation = await invoke(req => confirm(req, { params: Promise.resolve({ id: assignment.id }) }), teacherUser.id, 'PATCH', { status: 'ACCEPTED' });
      assert.equal(confirmation.status, 200);
      assert.ok(!(await confirmation.text()).includes(note));

      await db.schulamtProfile.update({ where: { userId: office.id }, data: { mailProvider: 'SMTP' } });
      const loaded = await db.request.findUniqueOrThrow({ where: { id: saved.id }, include: { school: { include: { user: true } } } });
      await db.$transaction(tx => enqueueAssignmentEmailsInTransaction(tx, { teacher: { ...teacher, email: teacherUser.email }, request: loaded, entries: [{ date: body.date, hours: 4 }], schulamtId: office.id }));
      const mails = await db.emailOutbox.findMany({ where: { schulamtId: office.id } });
      assert.ok(mails.length > 0);
      for (const mail of mails) assert.ok(!revealSecret(mail.payloadEncrypted!).includes(note), 'email and calendar attachments must not contain private notes');

      const backup = await generateBackupData(office.id);
      assert.equal(backup.data.requests.find(row => row.id === saved.id)?.urgencyNote, note);
      const restored = await invoke(restore, office.id, 'POST', backup);
      assert.equal(restored.status, 200, await restored.text());
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: saved.id } })).urgencyNote, note);

      const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 45);
      await db.request.update({ where: { id: saved.id }, data: { date: oldDate } });
      const ongoing = await db.request.create({ data: { schoolId, date: oldDate, isOpenEnded: true, hours: 1, substitutedTeacher: 'Test', qualifications: '', status: 'PENDING', urgencyNote: note } });
      await runGdprCleanup();
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: saved.id } })).urgencyNote, null);
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: ongoing.id } })).urgencyNote, note);
    } finally {
      await db.emailOutbox.deleteMany({ where: { schulamtId: { in: users } } });
      if (schoolId) {
        await db.assignment.deleteMany({ where: { request: { schoolId } } });
        await db.request.deleteMany({ where: { schoolId } });
        await db.teacher.deleteMany({ where: { stammschuleId: schoolId } });
        await db.user.deleteMany({ where: { schoolId } });
        await db.school.delete({ where: { id: schoolId } });
      }
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
      const { prisma } = await import('../src/lib/prisma'); await prisma.$disconnect();
    }
  });
}
