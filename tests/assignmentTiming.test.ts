import assert from 'node:assert/strict';
import test from 'node:test';
import { assignmentLessonHours, assignmentStartLabel, resolveAssignmentLessonHours } from '../src/lib/assignmentTiming';

const request = { hours: 4, startHour: 1, schedule: JSON.stringify({ 2: [1, 2, 3, 4] }) };
const teacher = { isPartTime: true, schedule: JSON.stringify({ 2: [3, 4] }) };
const input = { request, teacher, date: '2026-10-20', hours: 2, existing: [] };

test('a partial assignment stores its actual later lesson start and survives timetable changes', () => {
  const lessonHours = resolveAssignmentLessonHours(input);
  assert.equal(lessonHours, '[3,4]');
  assert.equal(assignmentStartLabel({ hours: 2, lessonHours }), 'ab 3. Std.');
  assert.equal(resolveAssignmentLessonHours({ ...input, teacher: { ...teacher, schedule: '{"2":[1,2]}' } }), '[1,2]');
  assert.equal(assignmentStartLabel({ hours: 2, lessonHours }), 'ab 3. Std.', 'the saved assignment does not use the new teacher timetable');
});

test('a subsequent flexible reserve receives only still unoccupied lesson slots', () => {
  assert.equal(resolveAssignmentLessonHours({
    ...input, teacher: { isPartTime: false }, existing: [{ hours: 2, lessonHours: '[3,4]' }],
  }), '[1,2]');
  assert.equal(resolveAssignmentLessonHours({
    ...input, teacher: { isPartTime: false }, existing: [{ hours: 1, lessonHours: '[1]' }, { hours: 1, lessonHours: '[3]' }],
  }), '[2,4]');
});

test('explicit timetable exceptions retain regular hours first and record additional requested slots', () => {
  assert.equal(resolveAssignmentLessonHours({ ...input, hours: 3 }), null);
  assert.equal(resolveAssignmentLessonHours({ ...input, hours: 3, allowTimetableOverride: true }), '[1,3,4]');
  assert.equal(resolveAssignmentLessonHours({
    ...input, teacher: { isPartTime: true, schedule: '{}' }, allowTimetableOverride: true,
  }), '[1,2]');
});

test('unknown legacy slots and invalid snapshots never invent a lesson start', () => {
  assert.equal(resolveAssignmentLessonHours({
    ...input, teacher: { isPartTime: false }, existing: [{ hours: 2 }],
  }), null);
  for (const lessonHours of [undefined, null, 'null', '[3,3]', '[0,3]', '[3,11]', '[3]', '["3",4]', '{}', 'invalid']) {
    const assignment = { hours: 2, lessonHours };
    assert.equal(assignmentLessonHours(assignment), null);
    assert.equal(assignmentStartLabel(assignment), 'Beginn bitte mit der Schule abstimmen');
  }
});

test('single-day, non-contiguous and Berlin calendar-day schedules keep exact lessons', () => {
  assert.equal(resolveAssignmentLessonHours({
    ...input, request: { hours: 2, startHour: 3 }, teacher: { isPartTime: false },
  }), '[3,4]');
  const nonContiguous = { ...input, teacher: { isPartTime: false }, request: { ...request, schedule: '{"2":[5,3]}' } };
  assert.equal(resolveAssignmentLessonHours(nonContiguous), '[3,5]');
  assert.equal(resolveAssignmentLessonHours({ ...nonContiguous, date: new Date('2026-10-19T22:30:00Z') }), '[3,5]');
});
