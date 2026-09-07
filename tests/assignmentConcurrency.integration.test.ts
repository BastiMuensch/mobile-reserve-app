import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { validateAndCreateAssignments } from '../src/lib/assignService';

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('Assignment Concurrency Integration Test (Skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => {
    assert.ok(true);
  });
} else {
  const prisma = new PrismaClient({
    datasources: { db: { url: testDbUrl } },
  });

  test('Concurrent assignments for same teacher and date results in exactly one success and one conflict', async () => {
    // 1. Setup isolated test data in test database
    const testSchulamtUser = await prisma.user.create({
      data: {
        email: `test-schulamt-${Date.now()}@test.local`,
        password: 'hash',
        role: 'SCHULAMT',
      },
    });

    const testSchool = await prisma.school.create({
      data: {
        name: 'Test Schule',
        address: 'Teststr. 1',
        type: 'GRUNDSCHULE',
        schulamtId: testSchulamtUser.id,
      },
    });

    const testTeacher = await prisma.teacher.create({
      data: {
        name: 'Test Lehrer',
        stammschuleId: testSchool.id,
        status: 'ACTIVE',
        maxWeeklyHours: 28,
        isPartTime: false,
        qualifications: 'Grundschule',
        address: 'Testweg 1',
        postalCode: '80331',
        homeLat: 48.13,
        homeLng: 11.58,
        preferredType: 'BOTH',
        schoolYear: '2025/2026',
      },
    });

    const testRequest1 = await prisma.request.create({
      data: {
        schoolId: testSchool.id,
        date: new Date('2026-05-18T00:00:00.000Z'),
        hours: 4,
        weeklyHours: 4,
        schoolType: 'GRUNDSCHULE',
        substitutedTeacher: 'Frau A',
        qualifications: 'Grundschule',
        priority: 'UNPLANNED_ABSENCE',
        status: 'PENDING',
      },
    });

    const testRequest2 = await prisma.request.create({
      data: {
        schoolId: testSchool.id,
        date: new Date('2026-05-18T00:00:00.000Z'),
        hours: 4,
        weeklyHours: 4,
        schoolType: 'GRUNDSCHULE',
        substitutedTeacher: 'Herr B',
        qualifications: 'Grundschule',
        priority: 'UNPLANNED_ABSENCE',
        status: 'PENDING',
      },
    });

    try {
      // 2. Launch two concurrent assignment transactions for the same teacher on the exact same date
      const assignPayload1 = {
        requestId: testRequest1.id,
        teacherId: testTeacher.id,
        entries: [{ date: '2026-05-18', hours: 4 }],
        schulamtId: testSchulamtUser.id,
      };

      const assignPayload2 = {
        requestId: testRequest2.id,
        teacherId: testTeacher.id,
        entries: [{ date: '2026-05-18', hours: 4 }],
        schulamtId: testSchulamtUser.id,
      };

      // PostgreSQL may abort either (or both) initial Serializable attempts.
      // The assignment endpoints retry P2034; exercise that same contract here
      // before asserting the durable outcome.
      const assignWithSerializationRetry = async (payload: typeof assignPayload1) => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            return await prisma.$transaction(
              tx => validateAndCreateAssignments(tx, payload),
              { isolationLevel: 'Serializable' }
            );
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, attempt * 25));
              continue;
            }
            throw error;
          }
        }
        throw new Error('unreachable');
      };
      const results = await Promise.allSettled([assignWithSerializationRetry(assignPayload1), assignWithSerializationRetry(assignPayload2)]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      const rejectionReasons = rejected.map((result) => result.status === 'rejected'
        ? String(result.reason instanceof Error ? result.reason.message : result.reason)
        : '');
      assert.equal(fulfilled.length, 1, `Exactly one concurrent assignment must succeed (${rejectionReasons.join('; ')})`);
      assert.equal(rejected.length, 1, 'The other concurrent assignment must fail with a conflict');

      // Verify that database has exactly 1 non-rejected assignment for that day
      const dbAssignments = await prisma.assignment.findMany({
        where: {
          teacherId: testTeacher.id,
          date: new Date('2026-05-18T00:00:00.000Z'),
          status: { not: 'REJECTED' },
        },
      });
      assert.equal(dbAssignments.length, 1, 'Only 1 active assignment allowed by partial unique index');
    } finally {
      // Cleanup test data
      await prisma.assignment.deleteMany({ where: { teacherId: testTeacher.id } });
      await prisma.request.deleteMany({ where: { schoolId: testSchool.id } });
      await prisma.teacher.deleteMany({ where: { id: testTeacher.id } });
      await prisma.school.deleteMany({ where: { id: testSchool.id } });
      await prisma.user.deleteMany({ where: { id: testSchulamtUser.id } });
      await prisma.$disconnect();
    }
  });
}
