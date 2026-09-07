import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeacherLeaveOverlapWhere } from '../src/lib/assignService';

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
