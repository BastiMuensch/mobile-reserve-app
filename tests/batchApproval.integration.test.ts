import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  validateAndCreateAssignments,
  enqueueAssignmentEmailsInTransaction,
} from '../src/lib/assignService';
import {
  BatchOvertimeConfirmationRequired,
  requireBatchOvertimeConsent,
} from '../src/lib/batchPlanning';

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
    await prisma.teacher.deleteMany({ where: { id: fixture.teacherId } });
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
