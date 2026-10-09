import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeacherLeaveOverlapWhere, resolveTeacherNotificationRecipient, TimetableConflictError, validateAndCreateAssignments } from '../src/lib/assignService';
import { availableRequestHoursForTeacher, canTeacherCoverRequestHours, requiredLessonHoursForDay } from '../src/lib/matching';
import type { Prisma } from '@prisma/client';

test('leave overlap filter keeps the teacher/person condition separate from the date condition', () => {
  const rangeStart = new Date('2026-09-07T00:00:00.000Z');
  const rangeEnd = new Date('2026-09-11T23:59:59.999Z');

  assert.deepEqual(
    buildTeacherLeaveOverlapWhere('teacher-current-year', 'person-user', rangeStart, rangeEnd),
    {
      AND: [
        {
          OR: [
            { teacherId: 'teacher-current-year' },
            { teacher: { userId: 'person-user' } },
          ],
        },
        { startDate: { lte: rangeEnd } },
        { OR: [{ endDate: null }, { endDate: { gte: rangeStart } }] },
      ],
    }
  );
});

test('leave overlap filter falls back to the exact teacher row without a linked user', () => {
  const rangeStart = new Date('2026-09-07T00:00:00.000Z');
  const rangeEnd = new Date('2026-09-11T23:59:59.999Z');

  assert.deepEqual(
    buildTeacherLeaveOverlapWhere('teacher-only', null, rangeStart, rangeEnd),
    {
      AND: [
        { teacherId: 'teacher-only' },
        { startDate: { lte: rangeEnd } },
        { OR: [{ endDate: null }, { endDate: { gte: rangeStart } }] },
      ],
    }
  );
});

test('part-time availability permits the available part of a larger lesson block', () => {
  const request = {
    date: new Date('2026-05-04T00:00:00.000Z'),
    hours: 2,
    startHour: 1,
    schedule: JSON.stringify({ '1': [1, 5], '2': [3, 4] }),
  };
  const teacher = { isPartTime: true, schedule: JSON.stringify({ '1': [1, 2], '2': [3] }) };

  assert.deepEqual(requiredLessonHoursForDay(request, '2026-05-04'), [1, 5]);
  assert.equal(canTeacherCoverRequestHours(teacher, request, '2026-05-04', 2), false, 'hour 5 is unavailable');
  assert.equal(canTeacherCoverRequestHours(teacher, request, '2026-05-04', 1), true, 'the available lesson can be assigned');
  assert.equal(canTeacherCoverRequestHours(teacher, request, '2026-05-05', 1), true, 'weekday-specific availability permits partial coverage');
  assert.equal(canTeacherCoverRequestHours({ isPartTime: true, schedule: null }, request, '2026-05-04', 1), false);
  assert.equal(availableRequestHoursForTeacher(teacher, request, '2026-05-04'), 1);
  assert.equal(canTeacherCoverRequestHours(teacher, request, '2026-05-04', 0), false);
});

test('teacher notification recipient prefers login email and falls back to contact email', () => {
  assert.equal(resolveTeacherNotificationRecipient({ user: { email: 'login@example.test' }, email: 'contact@example.test' }), 'login@example.test');
  assert.equal(resolveTeacherNotificationRecipient({ user: null, email: 'contact@example.test' }), 'contact@example.test');
  assert.equal(resolveTeacherNotificationRecipient({ user: { email: '   ' }, email: '  contact@example.test  ' }), 'contact@example.test');
  assert.equal(resolveTeacherNotificationRecipient({ user: null, email: null }), null);
});

test('assignment approval stores only available hours and leaves the remaining demand open', async () => {
  const rows: { date: Date; hours: number; status: string }[] = [];
  let persistedStatus = 'PENDING';
  const request = {
    id: 'request', schoolId: 'school', date: new Date('2026-10-12T00:00:00Z'),
    hours: 6, startHour: 1, status: 'PENDING', school: { schulamtId: 'office' }, assignments: rows,
  };
  const tx = {
    request: {
      findUnique: async () => request,
      update: async ({ data }: { data: { status: string } }) => { persistedStatus = data.status; },
    },
    teacher: { findUnique: async () => ({
      id: 'reserve', stammschuleId: 'school', stammschule: { schulamtId: 'office' },
      status: 'ACTIVE', schoolYear: '2026/2027', maxWeeklyHours: 4,
      isPartTime: true, schedule: JSON.stringify({ '1': [1, 2, 3, 4] }),
    }) },
    assignment: {
      findMany: async () => [],
      createMany: async ({ data }: { data: { date: Date; hours: number }[] }) => {
        rows.push(...data.map(row => ({ ...row, status: 'PENDING' })));
      },
    },
    absence: { findMany: async () => [] },
    leavePeriod: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(validateAndCreateAssignments(tx, {
    requestId: 'request', teacherId: 'reserve', schulamtId: 'office', entries: [{ date: '2026-10-12', hours: 6 }],
  }), TimetableConflictError);
  assert.equal(rows.length, 0);

  const result = await validateAndCreateAssignments(tx, {
    requestId: 'request', teacherId: 'reserve', schulamtId: 'office', entries: [{ date: '2026-10-12', hours: 4 }],
  });
  assert.equal(result.createdCount, 1);
  assert.equal(result.warning, undefined);
  assert.equal(rows[0].hours, 4);
  assert.equal(persistedStatus, 'PARTIALLY_FILLED');
});
