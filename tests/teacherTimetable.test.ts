import test from 'node:test';
import assert from 'node:assert/strict';
import { teacherScheduleSchema } from '../src/lib/teacherUpdate';
import { parseStoredTimetable } from '../src/lib/timetable';
import { availableRequestHoursForTeacher } from '../src/lib/matching';

const malformed = [
  42, [], 'invalid', { 1: 42 }, { 1: '12' }, { 1: [1, 1] },
  { 1: [0] }, { 1: [11] }, { 1: [1.5] }, { 1: ['1'] },
  { 0: [1] }, { 6: [1] }, { monday: [1] }, { 1: [NaN] },
];

test('all teacher write paths share a bounded timetable shape', () => {
  for (const schedule of malformed) {
    assert.equal(teacherScheduleSchema.safeParse(schedule).success, false, JSON.stringify(schedule));
  }
  for (const schedule of [undefined, null, {}, { 1: [], 2: [4, 3], 5: [10] }]) {
    assert.equal(teacherScheduleSchema.safeParse(schedule).success, true);
  }
});

test('malformed stored teacher timetables offer no hours and do not break matching', () => {
  const request = { date: '2026-10-20', startHour: 1, hours: 4 };
  for (const value of malformed) {
    const schedule = JSON.stringify(value);
    assert.equal(parseStoredTimetable(schedule), null);
    assert.equal(availableRequestHoursForTeacher({ isPartTime: true, schedule }, request, request.date), 0);
  }
  assert.equal(availableRequestHoursForTeacher({
    isPartTime: true, schedule: JSON.stringify({ 2: [3, 4] }),
  }, request, request.date), 2);
});
