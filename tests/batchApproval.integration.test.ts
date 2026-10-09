import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { PrismaClient } from '@prisma/client';
import {
  validateAndCreateAssignments,
  enqueueAssignmentEmailsInTransaction,
} from '../src/lib/assignService';
import {
  BatchOvertimeConfirmationRequired,
  requireBatchOvertimeConsent,
} from '../src/lib/batchPlanning';
import { getOpenRequestDays } from '../src/lib/requestDays';
import { getSchoolYearForDate } from '../src/lib/schoolYear';
import { toLocalDateInputValue } from '../src/lib/dateKey';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('Batch approval integration tests (Skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => {
    assert.ok(true);
  });
} else {
  // Enqueuing is deliberately exercised inside the transaction. A deterministic
  // key makes that safe in test only; no delivery is attempted from this file.
  process.env.SMTP_ENCRYPTION_KEY ??= Buffer.alloc(32, 17).toString('base64');
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  type Fixture = {
    schulamtId: string;
    schoolId: string;
    teacherId: string;
    requestIds: string[];
  };

  async function createFixture(options: { maxWeeklyHours: number; requests?: number } = { maxWeeklyHours: 2 }): Promise<Fixture> {
    const key = `batch-approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const schulamt = await prisma.user.create({
      data: { email: `${key}@test.local`, password: 'hash', role: 'SCHULAMT' },
    });
    const school = await prisma.school.create({
      data: { name: key, address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: schulamt.id },
    });
    const teacher = await prisma.teacher.create({
      data: {
        name: 'Batch Test Lehrkraft', email: `${key}-teacher@test.local`, stammschuleId: school.id,
        status: 'ACTIVE', maxWeeklyHours: options.maxWeeklyHours, isPartTime: false,
        qualifications: 'Grundschule', address: 'Testweg 2', postalCode: '80331',
        homeLat: 48.13, homeLng: 11.58, preferredType: 'BOTH', schoolYear: '2026/2027',
      },
    });
    const requestIds: string[] = [];
    for (let index = 0; index < (options.requests ?? 1); index += 1) {
      const request = await prisma.request.create({
        data: {
          schoolId: school.id, date: new Date('2026-09-07T00:00:00.000Z'), hours: 4, weeklyHours: 4,
          schoolType: 'GRUNDSCHULE', substitutedTeacher: `Vertretung ${index + 1}`,
          qualifications: 'Grundschule', priority: 'UNPLANNED_ABSENCE', status: 'PENDING',
        },
      });
      requestIds.push(request.id);
    }
    return { schulamtId: schulamt.id, schoolId: school.id, teacherId: teacher.id, requestIds };
  }

  async function destroyFixture(fixture: Fixture): Promise<void> {
    await prisma.assignment.deleteMany({ where: { request: { schoolId: fixture.schoolId } } });
    await prisma.request.deleteMany({ where: { schoolId: fixture.schoolId } });
    await prisma.emailOutbox.deleteMany({ where: { schulamtId: fixture.schulamtId } });
    await prisma.teacher.deleteMany({ where: { stammschuleId: fixture.schoolId } });
    await prisma.school.deleteMany({ where: { id: fixture.schoolId } });
    await prisma.user.deleteMany({ where: { id: fixture.schulamtId } });
  }

  async function stageSegment(
    tx: Parameters<typeof validateAndCreateAssignments>[0],
    fixture: Fixture,
    requestId: string,
  ): Promise<string[]> {
    const result = await validateAndCreateAssignments(tx, {
      requestId, teacherId: fixture.teacherId, schulamtId: fixture.schulamtId,
      entries: [{ date: '2026-09-07', hours: 4 }],
    });
    const [teacher, request] = await Promise.all([
      tx.teacher.findUniqueOrThrow({ where: { id: fixture.teacherId } }),
      tx.request.findUniqueOrThrow({
        where: { id: requestId },
        include: { school: { include: { user: true } } },
      }),
    ]);
    await enqueueAssignmentEmailsInTransaction(tx, {
      teacher, request, entries: [{ date: '2026-09-07', hours: 4 }], schulamtId: fixture.schulamtId,
    });
    return result.warning ? [result.warning] : [];
  }

  test('unconfirmed batch overtime rolls back assignments, request status, and outbox entries', async () => {
    const fixture = await createFixture({ maxWeeklyHours: 2 });
    try {
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          const warnings = await stageSegment(tx, fixture, fixture.requestIds[0]);
          requireBatchOvertimeConsent(warnings, false);
        }),
        (error: unknown) => error instanceof BatchOvertimeConfirmationRequired
          && error.warnings.length === 1,
      );

      assert.equal(await prisma.assignment.count({ where: { requestId: fixture.requestIds[0] } }), 0);
      assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: fixture.requestIds[0] } })).status, 'PENDING');
      assert.equal(await prisma.emailOutbox.count({ where: { schulamtId: fixture.schulamtId } }), 0);
    } finally {
      await destroyFixture(fixture);
    }
  });

  test('explicit batch overtime consent commits the assignments and durable outbox intent', async () => {
    const fixture = await createFixture({ maxWeeklyHours: 2 });
    try {
      await prisma.$transaction(async (tx) => {
        const warnings = await stageSegment(tx, fixture, fixture.requestIds[0]);
        requireBatchOvertimeConsent(warnings, true);
      });

      assert.equal(await prisma.assignment.count({ where: { requestId: fixture.requestIds[0] } }), 1);
      assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: fixture.requestIds[0] } })).status, 'FILLED');
      assert.equal(await prisma.emailOutbox.count({ where: { schulamtId: fixture.schulamtId } }), 1);
    } finally {
      await destroyFixture(fixture);
    }
  });

  test('batch preview and approval persist partial capacity safely and reopen a rolling horizon', async t => {
    process.env.DATABASE_URL = testDbUrl;
    process.env.JWT_SECRET ??= 'batch-approval-integration-secret';
    const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
    t.after(() => hook.deregister());
    const { POST: preview } = await import('../src/app/api/batch-assign/preview/route');
    const { POST: approve } = await import('../src/app/api/batch-assign/approve/route');
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const invoke = async (handler: (request: Request) => Promise<Response>, userId: string, pathname: string, body: unknown) => {
      const request = new Request(`http://localhost${pathname}`, {
        method: 'POST', headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never,
        () => workUnitAsyncStorage.run(store, () => handler(request)));
    };
    const today = new Date(`${toLocalDateInputValue()}T12:00:00Z`);
    const firstWorkday = new Date(today);
    while (firstWorkday.getUTCDay() === 0 || firstWorkday.getUTCDay() === 6) firstWorkday.setUTCDate(firstWorkday.getUTCDate() + 1);
    const day = firstWorkday.toISOString().slice(0, 10);
    const schoolYear = getSchoolYearForDate(firstWorkday);
    const plan = { schoolYear, until: day };

    await t.test('four available hours are approved for a six-hour need; overlapping partial top-ups stay blocked', async () => {
      const fixture = await createFixture({ maxWeeklyHours: 4 });
      try {
        await prisma.schulamtProfile.create({ data: { userId: fixture.schulamtId, mailProvider: 'NONE' } });
        await prisma.school.update({ where: { id: fixture.schoolId }, data: { latitude: 48.13, longitude: 11.58 } });
        const teacher = await prisma.teacher.update({ where: { id: fixture.teacherId }, data: {
          schoolYear, isPartTime: true, schedule: JSON.stringify({ '1': [1, 2, 3, 4], '2': [1, 2, 3, 4], '3': [1, 2, 3, 4], '4': [1, 2, 3, 4], '5': [1, 2, 3, 4] }),
        } });
        await prisma.request.update({ where: { id: fixture.requestIds[0] }, data: { date: new Date(day), hours: 6, weeklyHours: 6, startHour: 1 } });
        const initialResponse = await invoke(preview, fixture.schulamtId, '/api/batch-assign/preview', plan);
        assert.equal(initialResponse.status, 200);
        const initial = await initialResponse.json();
        const item = initial.schools[0].proposals[0];
        assert.deepEqual(item.coverage, { assignedHours: 4, requiredHours: 6 });
        assert.deepEqual(item.segments[0].entries, [{ date: day, hours: 4 }]);
        const firstApproval = await invoke(approve, fixture.schulamtId, '/api/batch-assign/approve', {
          ...plan, schoolId: fixture.schoolId, items: [item],
        });
        assert.equal(firstApproval.status, 201, await firstApproval.text());
        assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: item.requestId } })).status, 'PARTIALLY_FILLED');
        assert.equal((await prisma.assignment.findFirstOrThrow({ where: { requestId: item.requestId } })).hours, 4);

        const other = await prisma.teacher.create({ data: {
          name: 'Zweite Teilzeitreserve', stammschuleId: fixture.schoolId, schoolYear,
          maxWeeklyHours: 4, isPartTime: true, schedule: teacher.schedule, status: 'ACTIVE',
          qualifications: teacher.qualifications, preferredType: teacher.preferredType, homeLat: teacher.homeLat, homeLng: teacher.homeLng,
        } });
        const blockedPreview = await (await invoke(preview, fixture.schulamtId, '/api/batch-assign/preview', plan)).json();
        assert.equal(blockedPreview.schools[0].proposals.length, 0, 'the same four lesson slots cannot fill the remaining two');
        const blockedApproval = await invoke(approve, fixture.schulamtId, '/api/batch-assign/approve', {
          ...plan, schoolId: fixture.schoolId, items: [{ requestId: item.requestId, segments: [{ teacherId: other.id, entries: [{ date: day, hours: 2 }] }] }],
        });
        assert.equal(blockedApproval.status, 409);
        assert.equal(await prisma.assignment.count({ where: { requestId: item.requestId } }), 1);

        await prisma.teacher.update({ where: { id: other.id }, data: { isPartTime: false, schedule: null } });
        const topUp = await (await invoke(preview, fixture.schulamtId, '/api/batch-assign/preview', plan)).json();
        const topUpItem = topUp.schools[0].proposals[0];
        assert.deepEqual(topUpItem.segments[0].entries, [{ date: day, hours: 2 }]);
        const topUpApproval = await invoke(approve, fixture.schulamtId, '/api/batch-assign/approve', {
          ...plan, schoolId: fixture.schoolId, items: [topUpItem],
        });
        assert.equal(topUpApproval.status, 201, await topUpApproval.text());
        assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: item.requestId } })).status, 'FILLED');
        assert.equal((await prisma.assignment.aggregate({ where: { requestId: item.requestId }, _sum: { hours: true } }))._sum.hours, 6);
      } finally {
        await destroyFixture(fixture);
      }
    });

    await t.test('a previously filled ongoing horizon returns to preview and accepts its new days', async () => {
      const fixture = await createFixture({ maxWeeklyHours: 40 });
      try {
        await prisma.schulamtProfile.create({ data: { userId: fixture.schulamtId, mailProvider: 'NONE' } });
        await prisma.school.update({ where: { id: fixture.schoolId }, data: { latitude: 48.13, longitude: 11.58 } });
        await prisma.teacher.update({ where: { id: fixture.teacherId }, data: { schoolYear } });
        const previousWeek = new Date(today);
        previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
        const ongoing = await prisma.request.update({ where: { id: fixture.requestIds[0] }, data: {
          date: previousWeek, isOpenEnded: true, endDate: null, hours: 4, status: 'FILLED',
        } });
        const previousDays = getOpenRequestDays(ongoing, [], previousWeek);
        await prisma.assignment.createMany({ data: previousDays.map(entry => ({
          requestId: ongoing.id, teacherId: fixture.teacherId, date: new Date(entry.date), hours: entry.hours,
        })) });
        const days = getOpenRequestDays(ongoing, [], today);
        // Keep the route plan in one school year at the September boundary.
        const currentYearDays = days.filter(entry => getSchoolYearForDate(new Date(entry.date)) === schoolYear);
        const ongoingPlan = { schoolYear, until: currentYearDays.at(-1)!.date };
        const previewResponse = await invoke(preview, fixture.schulamtId, '/api/batch-assign/preview', ongoingPlan);
        assert.equal(previewResponse.status, 200);
        const proposal = await previewResponse.json();
        const item = proposal.schools[0].proposals[0];
        assert.equal(item.requestId, ongoing.id);
        assert.equal(proposal.requestsById[ongoing.id].status, 'PARTIALLY_FILLED');
        assert.deepEqual(item.segments.flatMap((segment: { entries: { date: string }[] }) => segment.entries.map(entry => entry.date)), currentYearDays.map(entry => entry.date));
        const approval = await invoke(approve, fixture.schulamtId, '/api/batch-assign/approve', {
          ...ongoingPlan, schoolId: fixture.schoolId, items: [item],
        });
        assert.equal(approval.status, 201, await approval.text());
        const saved = await prisma.request.findUniqueOrThrow({ where: { id: ongoing.id }, include: { assignments: true } });
        assert.equal(saved.status, currentYearDays.length === days.length ? 'FILLED' : 'PARTIALLY_FILLED');
        assert.equal(saved.assignments.length, previousDays.length + currentYearDays.length);
      } finally {
        await destroyFixture(fixture);
      }
    });
  });

  test('a conflicting later segment rolls back the entire school approval transaction', async () => {
    const fixture = await createFixture({ maxWeeklyHours: 8, requests: 2 });
    try {
      await assert.rejects(prisma.$transaction(async (tx) => {
        await stageSegment(tx, fixture, fixture.requestIds[0]);
        // Same teacher and date makes this a realistic stale proposal conflict.
        await stageSegment(tx, fixture, fixture.requestIds[1]);
      }));

      assert.equal(await prisma.assignment.count({ where: { request: { schoolId: fixture.schoolId } } }), 0);
      const statuses = await prisma.request.findMany({
        where: { id: { in: fixture.requestIds } }, select: { status: true }, orderBy: { id: 'asc' },
      });
      assert.deepEqual(statuses.map(request => request.status), ['PENDING', 'PENDING']);
      assert.equal(await prisma.emailOutbox.count({ where: { schulamtId: fixture.schulamtId } }), 0);
    } finally {
      await destroyFixture(fixture);
      await prisma.$disconnect();
    }
  });
}
