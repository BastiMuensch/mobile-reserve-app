import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeacherLeaveOverlapWhere, resolveTeacherNotificationRecipient } from '../src/lib/assignService';
import { canTeacherCoverRequestHours, requiredLessonHoursForDay } from '../src/lib/matching';

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

test('part-time availability requires the complete exact lesson block, including partial assignments', () => {
  const request = {
    date: new Date('2026-05-04T00:00:00.000Z'),
    hours: 2,
    startHour: 1,
    schedule: JSON.stringify({ '1': [1, 5], '2': [3, 4] }),
  };
  const teacher = { isPartTime: true, schedule: JSON.stringify({ '1': [1, 2], '2': [3] }) };

  assert.deepEqual(requiredLessonHoursForDay(request, '2026-05-04'), [1, 5]);
  assert.equal(canTeacherCoverRequestHours(teacher, request, '2026-05-04', 2), false, 'hour 5 is unavailable');
  assert.equal(canTeacherCoverRequestHours(teacher, request, '2026-05-04', 1), false, 'a partial assignment cannot claim an unspecified subset of slots');
  assert.equal(canTeacherCoverRequestHours(teacher, request, '2026-05-05', 1), false, 'weekday-specific matching still requires every requested slot');
  assert.equal(canTeacherCoverRequestHours({ isPartTime: true, schedule: null }, request, '2026-05-04', 1), false);
});

test('teacher notification recipient prefers login email and falls back to contact email', () => {
  assert.equal(resolveTeacherNotificationRecipient({ user: { email: 'login@example.test' }, email: 'contact@example.test' }), 'login@example.test');
  assert.equal(resolveTeacherNotificationRecipient({ user: null, email: 'contact@example.test' }), 'contact@example.test');
  assert.equal(resolveTeacherNotificationRecipient({ user: { email: '   ' }, email: '  contact@example.test  ' }), 'contact@example.test');
  assert.equal(resolveTeacherNotificationRecipient({ user: null, email: null }), null);
});
