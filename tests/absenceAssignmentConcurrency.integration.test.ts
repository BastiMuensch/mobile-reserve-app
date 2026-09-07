import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { validateAndCreateAssignments } from '../src/lib/assignService';

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('Daily absence and assignment concurrency (Skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => assert.ok(true));
} else {
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('a daily absence wins over a concurrently validated assignment on the same teacher/day', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const day = new Date('2026-09-14T00:00:00.000Z');
    const office = await prisma.user.create({ data: { email: `absence-office-${suffix}@test.local`, password: 'hash', role: 'SCHULAMT' } });
    const school = await prisma.school.create({ data: { name: `Absence Test ${suffix}`, address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: office.id } });
    const teacher = await prisma.teacher.create({ data: {
      name: 'Concurrent Teacher', stammschuleId: school.id, status: 'ACTIVE', maxWeeklyHours: 28,
      isPartTime: false, qualifications: 'Alles', address: 'Testweg 2', postalCode: '80331',
      homeLat: 48.13, homeLng: 11.58, preferredType: 'BOTH', schoolYear: '2026/2027',
    } });
    const request = await prisma.request.create({ data: {
      schoolId: school.id, date: day, hours: 4, weeklyHours: 4, schoolType: 'GRUNDSCHULE',
      substitutedTeacher: 'Frau A', qualifications: 'Grundschule', priority: 'UNPLANNED_ABSENCE', status: 'PENDING',
    } });

    let releaseAssignmentAttempt!: () => void;
    let releaseAbsenceWrite!: () => void;
    const assignmentAttempted = new Promise<void>(resolve => { releaseAssignmentAttempt = resolve; });
    const absenceWritten = new Promise<void>(resolve => { releaseAbsenceWrite = resolve; });

    const persistAbsenceWithRouteTransactionPattern = async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await prisma.$transaction(async tx => {
            await tx.absence.create({ data: { teacherId: teacher.id, date: day, type: 'UNAVAILABLE', reason: 'Deterministic test absence' } });
            if (attempt === 1) {
              releaseAbsenceWrite();
              await assignmentAttempted;
            }
            const active = await tx.assignment.findMany({
              where: { teacherId: teacher.id, date: day, status: { not: 'REJECTED' } },
              select: { id: true },
            });
            if (active.length > 0) {
              await tx.assignment.updateMany({ where: { id: { in: active.map(item => item.id) } }, data: { status: 'REJECTED' } });
            }
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
          return;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) continue;
          throw error;
        }
      }
    };

    try {
      const absenceWork = persistAbsenceWithRouteTransactionPattern();
      const assignmentWork = (async () => {
        await absenceWritten;
        try {
          await prisma.$transaction(tx => validateAndCreateAssignments(tx, {
            requestId: request.id, teacherId: teacher.id, entries: [{ date: '2026-09-14', hours: 4 }], schulamtId: office.id,
          }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } finally {
          releaseAssignmentAttempt();
        }
      })();

      await Promise.allSettled([absenceWork, assignmentWork]);
      const [absences, activeAssignments] = await Promise.all([
        prisma.absence.findMany({ where: { teacherId: teacher.id, date: day, type: 'UNAVAILABLE' } }),
        prisma.assignment.findMany({ where: { teacherId: teacher.id, date: day, status: { not: 'REJECTED' } } }),
      ]);
      assert.equal(absences.length, 1, 'the daily absence must persist');
      assert.equal(activeAssignments.length, 0, 'no active assignment may coexist with the absence');
    } finally {
      await prisma.assignment.deleteMany({ where: { teacherId: teacher.id } });
      await prisma.absence.deleteMany({ where: { teacherId: teacher.id } });
      await prisma.request.deleteMany({ where: { id: request.id } });
      await prisma.teacher.delete({ where: { id: teacher.id } });
      await prisma.school.delete({ where: { id: school.id } });
      await prisma.user.delete({ where: { id: office.id } });
      await prisma.$disconnect();
    }
  });
}
