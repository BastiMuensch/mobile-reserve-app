import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTeachersByLastName, getAvailableTeachersToday } from '../src/lib/teacherOverview';
import { teacher } from './fixtures/uiRegressionData';
import type { TeacherData } from '../src/types/models';

const monday = new Date('2026-10-05T10:00:00Z');
const fullTime: TeacherData = { ...teacher, schoolYear: '2026/2027' };
const partTime: TeacherData = {
  ...fullTime, id: 'part-time', isPartTime: true,
  schedule: JSON.stringify({ '1': [2, 3], '2': [], '4': [1] }),
};

test('personnel sorts by surname, then given names, using German alphabetical order', () => {
  const names = ['Anna Zimmer', 'Zoe Bauer', 'Müller, Clara', 'Berta Müller', 'Anna Maria Müller', 'Lena Müller-Schmidt', 'Mia Oster', 'Paul Öster', 'Solo'];
  assert.deepEqual(names.map(name => ({ name })).sort(compareTeachersByLastName).map(t => t.name), [
    'Zoe Bauer', 'Anna Maria Müller', 'Berta Müller', 'Müller, Clara', 'Lena Müller-Schmidt', 'Mia Oster', 'Paul Öster', 'Solo', 'Anna Zimmer',
  ]);
  assert.equal(compareTeachersByLastName({ name: ' Anna   Müller ' }, { name: 'Müller, Anna' }), 0);
});

test('today includes part-time staff only on their scheduled working days', () => {
  assert.deepEqual(getAvailableTeachersToday([fullTime, partTime], monday), [fullTime, partTime]);
  assert.deepEqual(getAvailableTeachersToday([fullTime, partTime], new Date('2026-10-06T10:00:00Z')), [fullTime]);
  assert.deepEqual(getAvailableTeachersToday([fullTime, partTime], new Date('2026-10-07T10:00:00Z')), [fullTime]);
});

test('inactive, absent, on-leave and other school-year staff are excluded', () => {
  const excluded: TeacherData[] = [
    ...['PENDING', 'UNAVAILABLE', 'LEAVE'].map(status => ({ ...fullTime, status })),
    { ...fullTime, isAbsentToday: true },
    { ...fullTime, currentLeave: { id: 'leave', teacherId: fullTime.id, startDate: '2026-10-01', endDate: null, reportedBy: 'SCHULAMT' } },
    { ...fullTime, schoolYear: '2025/2026' },
    { ...fullTime, schoolYear: '2027/2028' },
  ];
  assert.deepEqual(getAvailableTeachersToday([...excluded, fullTime], monday), [fullTime]);
});

test('weekends are not working days for either full-time or part-time staff', () => {
  for (const date of ['2026-10-03', '2026-10-04']) {
    assert.deepEqual(getAvailableTeachersToday([fullTime, partTime], new Date(`${date}T10:00:00Z`)), []);
  }
});

test('working day uses Europe/Berlin even when the UTC date is still Sunday', () => {
  assert.deepEqual(getAvailableTeachersToday([partTime], new Date('2026-10-04T22:05:00Z')), [partTime]);
});

test('missing or malformed part-time schedules never imply availability', () => {
  for (const schedule of [undefined, '', '{', 'null', '[]', '{}', '{"1":"yes"}', '{"1":[0]}']) {
    assert.deepEqual(getAvailableTeachersToday([{ ...partTime, schedule }], monday), [], schedule);
  }
});

test('a short active assignment uses the whole day, while cancelled or other-day assignments do not', () => {
  const assignment = { id: 'assignment', requestId: 'request', teacherId: fullTime.id, date: '2026-10-05', hours: 3, status: 'PENDING' };
  assert.deepEqual(getAvailableTeachersToday([{ ...fullTime, assignments: [assignment] }], monday), []);
  assert.deepEqual(getAvailableTeachersToday([{ ...fullTime, assignments: [{ ...assignment, status: 'ACCEPTED' }] }], monday), []);
  for (const unblockingAssignment of [{ ...assignment, status: 'REJECTED' }, { ...assignment, date: '2026-10-06' }]) {
    const available = { ...fullTime, assignments: [unblockingAssignment] };
    assert.deepEqual(getAvailableTeachersToday([available], monday), [available]);
  }
});
