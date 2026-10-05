import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getOpenRequestDays } from '../src/lib/requestDays';
import { activeUnfilledDays, parseUnfilledDays } from '../src/lib/unfilledDays';
import { revealSecret } from '../src/lib/secrets';

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  test('Per-day reserve refusal routes (requires TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'unfilled-days-integration-secret';
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  process.env.SMTP_ENCRYPTION_KEY ??= Buffer.alloc(32, 32).toString('base64');
  if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
  test.after(() => prisma.$disconnect());

  async function fixture(openEnded = false) {
    const key = `unfilled-days-${crypto.randomUUID()}`;
    const tenant = await prisma.user.create({ data: { email: `${key}@example.invalid`, password: 'hash', role: 'SCHULAMT' } });
    const school = await prisma.school.create({ data: {
      name: 'Testschule', address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: tenant.id,
      user: { create: { email: `${key}-school@example.invalid`, password: 'hash', role: 'SCHOOL' } },
    }, include: { user: true } });
    const req = await prisma.request.create({ data: {
      schoolId: school.id, date: new Date(openEnded ? '2099-10-05' : '2026-10-05'),
      endDate: openEnded ? null : new Date('2026-10-07'), isOpenEnded: openEnded,
      hours: 5, weeklyHours: 15, status: 'PENDING', substitutedTeacher: 'Test', qualifications: '',
    } });
    const teacher = await prisma.teacher.create({ data: {
      name: 'Reserve', stammschuleId: school.id, status: 'ACTIVE', schoolYear: '2026/2027',
      maxWeeklyHours: 28, qualifications: '', homeLat: 48, homeLng: 11, preferredType: 'BOTH',
    } });
    return { tenant, school, req, teacher };
  }

  async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
    await prisma.assignment.deleteMany({ where: { requestId: f.req.id } });
    await prisma.request.delete({ where: { id: f.req.id } });
    await prisma.teacher.delete({ where: { id: f.teacher.id } });
    await prisma.user.delete({ where: { id: f.school.user!.id } });
    await prisma.school.delete({ where: { id: f.school.id } });
    await prisma.emailOutbox.deleteMany({ where: { schulamtId: f.tenant.id } });
    await prisma.user.delete({ where: { id: f.tenant.id } });
  }

  async function invoke(f: Awaited<ReturnType<typeof fixture>>, method: 'PATCH' | 'DELETE', body: unknown, userId = f.tenant.id) {
    const handlers = await import('../src/app/api/requests/[id]/unfilled/route');
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const token = await signToken({ id: userId, sessionVersion: 0 });
    const pathname = `/api/requests/${f.req.id}/unfilled`;
    const request = new Request(`http://localhost${pathname}`, {
      method, headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
    return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () =>
      workUnitAsyncStorage.run(store, () => handlers[method](request, { params: Promise.resolve({ id: f.req.id }) })));
  }

  test('ongoing refusal affects one date, retains tomorrow and notifies the exact date', async () => {
    const f = await fixture(true);
    try {
      const days = getOpenRequestDays(f.req);
      const date = days[0].date;
      const response = await invoke(f, 'PATCH', { date, reason: 'Heute keine Reserve' });
      assert.equal(response.status, 200, await response.text());
      const saved = await prisma.request.findUniqueOrThrow({ where: { id: f.req.id } });
      assert.equal(saved.status, 'PENDING');
      assert.deepEqual(activeUnfilledDays(saved.unfilledDays).map(day => day.date), [date]);
      assert.equal(getOpenRequestDays(saved)[0].date, days[1].date);
      const mails = await prisma.emailOutbox.findMany({ where: { schulamtId: f.tenant.id } });
      assert.equal(mails.length, 1);
      const mail = JSON.parse(revealSecret(mails[0].payloadEncrypted!));
      assert.match(mail.body, /ausschließlich für diesen Tag/);
      assert.match(mail.body, /Heute keine Reserve/);
      assert.equal(mail.to, f.school.user!.email);
      assert.equal((await invoke(f, 'PATCH', { date })).status, 409, 'a repeated decision must not enqueue another notice');
      assert.equal(await prisma.emailOutbox.count({ where: { schulamtId: f.tenant.id } }), 1);
    } finally { await cleanup(f); }
  });

  test('fixed requests stay open until all dates are resolved and reversing one date preserves history', async () => {
    const f = await fixture();
    try {
      for (const date of ['2026-10-05', '2026-10-06', '2026-10-07']) {
        const response = await invoke(f, 'PATCH', { date });
        assert.equal(response.status, 200, await response.text());
      }
      const saved = await prisma.request.findUniqueOrThrow({ where: { id: f.req.id } });
      assert.equal(saved.status, 'UNFILLED');
      assert.deepEqual(getOpenRequestDays(saved), []);
      const response = await invoke(f, 'DELETE', { date: '2026-10-06' });
      assert.equal(response.status, 200, await response.text());
      const reopened = await prisma.request.findUniqueOrThrow({ where: { id: f.req.id } });
      assert.equal(reopened.status, 'PENDING');
      assert.deepEqual(getOpenRequestDays(reopened).map(day => day.date), ['2026-10-06']);
      assert.equal(parseUnfilledDays(reopened.unfilledDays).length, 3);
      assert.ok(parseUnfilledDays(reopened.unfilledDays).find(day => day.date === '2026-10-06')!.revertedAt);
      assert.equal(activeUnfilledDays(reopened.unfilledDays).length, 2);
    } finally { await cleanup(f); }
  });

  test('partly covered dates keep their assignment; refused dates reject new assignments until reversal', async () => {
    const f = await fixture();
    try {
      const assignment = await prisma.assignment.create({ data: { requestId: f.req.id, teacherId: f.teacher.id, date: f.req.date, hours: 2, status: 'ACCEPTED' } });
      await prisma.request.update({ where: { id: f.req.id }, data: { status: 'PARTIALLY_FILLED' } });
      const response = await invoke(f, 'PATCH', { date: '2026-10-05' });
      assert.equal(response.status, 200, await response.text());
      assert.deepEqual(await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } }), assignment);
      const saved = await prisma.request.findUniqueOrThrow({ where: { id: f.req.id } });
      assert.equal(saved.status, 'PARTIALLY_FILLED');
      assert.deepEqual(getOpenRequestDays(saved, [assignment]).map(day => day.date), ['2026-10-06', '2026-10-07']);
      const { validateAndCreateAssignments, HoursExceededError } = await import('../src/lib/assignService');
      await assert.rejects(prisma.$transaction(tx => validateAndCreateAssignments(tx, {
        requestId: f.req.id, teacherId: f.teacher.id, entries: [{ date: '2026-10-05', hours: 3 }], schulamtId: f.tenant.id,
      })), HoursExceededError);
      await prisma.$transaction(tx => validateAndCreateAssignments(tx, {
        requestId: f.req.id, teacherId: f.teacher.id, entries: [{ date: '2026-10-06', hours: 5 }], schulamtId: f.tenant.id,
      }));
      assert.equal(await prisma.assignment.count({ where: { requestId: f.req.id } }), 2);
    } finally { await cleanup(f); }
  });

  test('refusal validation rejects missing, invalid and out-of-range dates and school users', async () => {
    const f = await fixture();
    try {
      assert.equal((await invoke(f, 'PATCH', {})).status, 400);
      assert.equal((await invoke(f, 'PATCH', { date: '2026-02-31' })).status, 400);
      assert.equal((await invoke(f, 'PATCH', { date: '2026-10-08' })).status, 409);
      assert.equal((await invoke(f, 'PATCH', { date: '2026-10-05' }, f.school.user!.id)).status, 401);
      assert.equal((await invoke(f, 'DELETE', { date: '2026-10-05' })).status, 409);
      assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: f.req.id } })).unfilledDays, null);
      assert.equal(await prisma.emailOutbox.count({ where: { schulamtId: f.tenant.id } }), 0);
    } finally { await cleanup(f); }
  });

  test('legacy whole-request refusal remains reversible without rewriting its history', async () => {
    const f = await fixture();
    try {
      await prisma.request.update({ where: { id: f.req.id }, data: { status: 'UNFILLED', unfilledReason: 'Legacy decision', unfilledAt: new Date() } });
      const response = await invoke(f, 'DELETE', undefined);
      assert.equal(response.status, 200, await response.text());
      const saved = await prisma.request.findUniqueOrThrow({ where: { id: f.req.id } });
      assert.equal(saved.status, 'PENDING');
      assert.equal(saved.unfilledReason, null);
      assert.equal(saved.unfilledDays, null);
      assert.equal(getOpenRequestDays(saved).length, 3);
    } finally { await cleanup(f); }
  });
}
