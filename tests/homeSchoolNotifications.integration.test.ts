import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { enqueueHomeSchoolNotifications } from '../src/lib/homeSchoolNotifications';
import { enqueueAssignmentEmailsInTransaction, validateAndCreateAssignments } from '../src/lib/assignService';
import { revealSecret } from '../src/lib/secrets';

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('Home-school notifications (requires TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'home-school-notifications-integration-secret';
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
  process.env.SMTP_ENCRYPTION_KEY ??= Buffer.alloc(32, 31).toString('base64');
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
  test.after(() => prisma.$disconnect());

  async function fixture() {
    const key = `home-notices-${crypto.randomUUID()}`;
    const tenant = await prisma.user.create({ data: { email: `${key}@example.invalid`, password: 'hash', role: 'SCHULAMT' } });
    const home = await prisma.school.create({ data: {
      name: 'Stammschule', address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: tenant.id, reserveNotificationsEnabled: true,
      user: { create: { email: `${key}-school@example.invalid`, password: 'hash', role: 'SCHOOL' } },
    }, include: { user: true } });
    const destination = await prisma.school.create({ data: { name: 'Einsatzschule', address: 'Testweg 2', type: 'GRUNDSCHULE', schulamtId: tenant.id } });
    const teacher = await prisma.teacher.create({ data: {
      name: 'Reserve Muster', stammschuleId: home.id, status: 'ACTIVE', schoolYear: '2026/2027',
      maxWeeklyHours: 28, qualifications: 'Grundschule', homeLat: 48, homeLng: 11, preferredType: 'BOTH',
    } });
    const request = await prisma.request.create({ data: {
      schoolId: destination.id, date: new Date('2026-09-07'), endDate: new Date('2026-09-08'), hours: 2, weeklyHours: 4,
      status: 'PENDING', substitutedTeacher: 'Privater Vertretungsname', comments: 'Vertraulicher Kommentar', qualifications: '',
    }, include: { school: { include: { user: true } } } });
    const entries = [{ date: '2026-09-07', hours: 2 }, { date: '2026-09-08', hours: 2 }];
    return { tenant, home, destination, teacher, request, entries };
  }

  async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
    await prisma.absence.deleteMany({ where: { teacherId: f.teacher.id } });
    await prisma.assignment.deleteMany({ where: { teacherId: f.teacher.id } });
    await prisma.request.delete({ where: { id: f.request.id } });
    await prisma.teacher.delete({ where: { id: f.teacher.id } });
    await prisma.user.delete({ where: { id: f.home.user!.id } });
    await prisma.school.deleteMany({ where: { id: { in: [f.home.id, f.destination.id] } } });
    await prisma.emailOutbox.deleteMany({ where: { schulamtId: f.tenant.id } });
    await prisma.user.delete({ where: { id: f.tenant.id } });
  }

  async function assign(f: Awaited<ReturnType<typeof fixture>>) {
    return prisma.$transaction(async tx => {
      await validateAndCreateAssignments(tx, { requestId: f.request.id, teacherId: f.teacher.id, entries: f.entries, schulamtId: f.tenant.id });
      return enqueueAssignmentEmailsInTransaction(tx, { teacher: f.teacher, request: f.request, entries: f.entries, schulamtId: f.tenant.id });
    });
  }

  async function invoke(userId: string, pathname: string, method: string, body: unknown, handler: (request: Request) => Promise<Response>) {
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const token = await signToken({ id: userId, sessionVersion: 0 });
    const request = new Request(`http://localhost${pathname}`, {
      method, headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
    return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () =>
      workUnitAsyncStorage.run(store, () => handler(request)));
  }

  async function homeMails(f: Awaited<ReturnType<typeof fixture>>) {
    const rows = await prisma.emailOutbox.findMany({ where: { schulamtId: f.tenant.id } });
    return rows.map(row => JSON.parse(revealSecret(row.payloadEncrypted!)) as { to: string; subject: string; body: string })
      .filter(mail => mail.to === f.home.user!.email);
  }

  test('committed pending assignments queue one private home-school notice for all assigned days', async () => {
    const f = await fixture();
    try {
      const result = await assign(f);
      assert.equal(result.outboxIds.length, 1);
      const item = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: result.outboxIds[0] } });
      assert.ok(item.payloadEncrypted?.startsWith('enc:v1:'));
      const mail = JSON.parse(revealSecret(item.payloadEncrypted!));
      assert.equal(mail.to, f.home.user!.email);
      assert.match(mail.body, /Reserve Muster/);
      assert.match(mail.body, /Einsatzschule/);
      assert.match(mail.body, /7\.9\.2026/);
      assert.match(mail.body, /8\.9\.2026/);
      assert.doesNotMatch(mail.body, /Privater Vertretungsname|Vertraulicher Kommentar/);
      assert.deepEqual((await prisma.assignment.findMany({ where: { teacherId: f.teacher.id } })).map(a => a.status), ['PENDING', 'PENDING']);
    } finally { await cleanup(f); }
  });

  test('home-school outbox intent rolls back with a failed assignment approval', async () => {
    const f = await fixture();
    try {
      await assert.rejects(prisma.$transaction(async tx => {
        await validateAndCreateAssignments(tx, { requestId: f.request.id, teacherId: f.teacher.id, entries: f.entries, schulamtId: f.tenant.id });
        const result = await enqueueAssignmentEmailsInTransaction(tx, { teacher: f.teacher, request: f.request, entries: f.entries, schulamtId: f.tenant.id });
        assert.equal(result.outboxIds.length, 1);
        throw new Error('approval rejected');
      }), /approval rejected/);
      assert.equal(await prisma.assignment.count({ where: { teacherId: f.teacher.id } }), 0);
      assert.equal(await prisma.emailOutbox.count({ where: { schulamtId: f.tenant.id } }), 0);
    } finally { await cleanup(f); }
  });

  test('opt-out, inactive or non-school accounts, and tenant mismatches suppress home notices', async () => {
    const f = await fixture();
    try {
      await assign(f);
      const notify = (schulamtId = f.tenant.id) => prisma.$transaction(tx => enqueueHomeSchoolNotifications(tx, {
        where: { teacherId: f.teacher.id }, event: 'ACCEPTED', schulamtId,
      }));
      await prisma.school.update({ where: { id: f.home.id }, data: { reserveNotificationsEnabled: false } });
      assert.deepEqual((await notify()).outboxIds, []);
      await prisma.school.update({ where: { id: f.home.id }, data: { reserveNotificationsEnabled: true } });
      await prisma.user.update({ where: { id: f.home.user!.id }, data: { isActive: false } });
      assert.deepEqual((await notify()).outboxIds, []);
      await prisma.user.update({ where: { id: f.home.user!.id }, data: { isActive: true, role: 'TEACHER' } });
      assert.deepEqual((await notify()).outboxIds, []);
      await prisma.user.update({ where: { id: f.home.user!.id }, data: { role: 'SCHOOL', email: `changed-${f.home.user!.email}` } });
      assert.deepEqual((await notify('another-tenant')).outboxIds, []);
      await prisma.school.update({ where: { id: f.destination.id }, data: { schulamtId: null } });
      assert.deepEqual((await notify()).outboxIds, []);
      await prisma.school.update({ where: { id: f.destination.id }, data: { schulamtId: f.tenant.id } });
      const result = await notify();
      const item = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: result.outboxIds[0] } });
      assert.equal(JSON.parse(revealSecret(item.payloadEncrypted!)).to, `changed-${f.home.user!.email}`);
    } finally { await cleanup(f); }
  });

  test('cancellation notices include previously pending assignments and survive their transactional deletion', async () => {
    const f = await fixture();
    try {
      await assign(f);
      const result = await prisma.$transaction(async tx => {
        const result = await enqueueHomeSchoolNotifications(tx, {
          where: { teacherId: f.teacher.id, status: { not: 'REJECTED' } }, event: 'CANCELLED', schulamtId: f.tenant.id,
        });
        await tx.assignment.deleteMany({ where: { teacherId: f.teacher.id } });
        return result;
      });
      assert.equal(result.outboxIds.length, 1);
      const item = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: result.outboxIds[0] } });
      assert.match(JSON.parse(revealSecret(item.payloadEncrypted!)).subject, /abgesagt/);
      assert.equal(await prisma.assignment.count({ where: { teacherId: f.teacher.id } }), 0);
    } finally { await cleanup(f); }
  });

  test('HTTP acceptance, absence, and deletion enqueue home notices only for actual transitions', async () => {
    const f = await fixture();
    const login = await prisma.user.create({ data: { email: `reserve-${crypto.randomUUID()}@example.invalid`, password: 'hash', role: 'TEACHER' } });
    try {
      await prisma.teacher.update({ where: { id: f.teacher.id }, data: { userId: login.id } });
      await assign(f);
      const assignments = await prisma.assignment.findMany({ where: { teacherId: f.teacher.id }, orderBy: { date: 'asc' } });
      const { PATCH } = await import('../src/app/api/assignments/[id]/status/route');
      const { POST: absence } = await import('../src/app/api/teachers/absence/route');
      const { DELETE } = await import('../src/app/api/assignments/[id]/route');
      const accept = () => invoke(login.id, `/api/assignments/${assignments[0].id}/status`, 'PATCH', { status: 'ACCEPTED' }, request => PATCH(request, { params: Promise.resolve({ id: assignments[0].id }) }));
      assert.equal((await accept()).status, 200);
      assert.equal((await accept()).status, 200);
      assert.equal((await homeMails(f)).filter(mail => /bestätigt/.test(mail.subject)).length, 1, 'idempotent acceptance must not mail twice');
      const absent = await invoke(login.id, '/api/teachers/absence', 'POST', { date: '2026-09-08', reason: 'Vertraulicher Ausfallgrund' }, absence);
      assert.equal(absent.status, 200, await absent.clone().text());
      let mails = await homeMails(f);
      assert.equal(mails.filter(mail => /abgesagt/.test(mail.subject)).length, 1, 'pending assignment cancellation is communicated');
      assert.ok(mails.every(mail => !mail.body.includes('Vertraulicher Ausfallgrund')));
      const remove = (id: string) => invoke(f.tenant.id, `/api/assignments/${id}`, 'DELETE', undefined, request => DELETE(request, { params: Promise.resolve({ id }) }));
      assert.equal((await remove(assignments[1].id)).status, 200);
      assert.equal((await homeMails(f)).filter(mail => /abgesagt/.test(mail.subject)).length, 1, 'deleting an already rejected row must not repeat its notice');
      assert.equal((await remove(assignments[0].id)).status, 200);
      mails = await homeMails(f);
      assert.equal(mails.filter(mail => /abgesagt/.test(mail.subject)).length, 2);
    } finally {
      await cleanup(f);
      await prisma.user.delete({ where: { id: login.id } });
    }
  });

  test('HTTP request end tells the home school the final day and cancels later pending days', async () => {
    const f = await fixture();
    try {
      await assign(f);
      await prisma.request.update({ where: { id: f.request.id }, data: { isOpenEnded: true, endDate: null } });
      const { PATCH } = await import('../src/app/api/requests/[id]/end/route');
      const response = await invoke(f.tenant.id, `/api/requests/${f.request.id}/end`, 'PATCH', { lastDay: '2026-09-07' }, async request => (await PATCH(request, { params: Promise.resolve({ id: f.request.id }) }))!);
      assert.equal(response.status, 200, await response.clone().text());
      const ended = (await homeMails(f)).filter(mail => /Einsatzende festgelegt/.test(mail.subject));
      assert.equal(ended.length, 1);
      assert.match(ended[0].body, /Letzter Einsatztag: 7\.9\.2026/);
      assert.doesNotMatch(ended[0].body, /Privater Vertretungsname|Vertraulicher Kommentar/);
      assert.equal(await prisma.assignment.count({ where: { teacherId: f.teacher.id, status: 'REJECTED' } }), 1);
    } finally { await cleanup(f); }
  });

  test('HTTP leave creation and extension notify only the newly cancelled assignment days', async () => {
    const f = await fixture();
    try {
      await assign(f);
      const { POST } = await import('../src/app/api/teachers/leave/route');
      const { PATCH } = await import('../src/app/api/teachers/leave/[leaveId]/route');
      const { createLeavePreviewToken } = await import('../src/lib/leavePreviewToken');
      const { normalizeLeaveRange } = await import('../src/lib/leaveService');
      const assignments = await prisma.assignment.findMany({ where: { teacherId: f.teacher.id }, orderBy: { date: 'asc' } });
      const firstRange = normalizeLeaveRange('2026-09-07', '2026-09-07');
      const create = await invoke(f.tenant.id, '/api/teachers/leave', 'POST', {
        teacherId: f.teacher.id, startDate: '2026-09-07', endDate: '2026-09-07',
        previewToken: createLeavePreviewToken([f.teacher.id], firstRange.start, firstRange.end, [assignments[0].id]),
      }, async request => (await POST(request))!);
      assert.equal(create.status, 201, await create.clone().text());
      assert.equal((await homeMails(f)).filter(mail => /abgesagt/.test(mail.subject)).length, 1);
      const { leave } = await create.json();
      const extendedRange = normalizeLeaveRange('2026-09-07', '2026-09-08');
      const update = await invoke(f.tenant.id, `/api/teachers/leave/${leave.id}`, 'PATCH', {
        endDate: '2026-09-08',
        previewToken: createLeavePreviewToken([f.teacher.id], extendedRange.start, extendedRange.end, [assignments[1].id]),
      }, async request => (await PATCH(request, { params: Promise.resolve({ leaveId: leave.id }) }))!);
      assert.equal(update.status, 200, await update.clone().text());
      assert.equal((await homeMails(f)).filter(mail => /abgesagt/.test(mail.subject)).length, 2);
      assert.equal(await prisma.assignment.count({ where: { teacherId: f.teacher.id, status: 'REJECTED' } }), 2);
    } finally { await cleanup(f); }
  });
}
