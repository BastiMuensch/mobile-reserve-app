import test from 'node:test';
import assert from 'node:assert/strict';
import { getPendingAssignmentConfirmations, getAssignmentDayPlan, isValidDayConfirmation } from '../src/lib/assignmentConfirmation';

const row = (id: string, date: string, status = 'PENDING', teacherId = 'teacher', requestId = 'request') => ({
  id, date, status, teacherId, requestId,
});

test('group confirmation includes actual pending days across a part-time multiweek assignment', () => {
  const first = row('a', '2026-10-05');
  const days = [row('c', '2026-10-19'), first, row('b', '2026-10-12')];
  assert.deepEqual(getPendingAssignmentConfirmations(first, days, '2026-10-05').map(a => a.id), ['a', 'b', 'c']);
});

test('group confirmation excludes past, accepted, cancelled, other-teacher and other-request days', () => {
  const first = row('a', '2026-10-05');
  const days = [
    first, row('past', '2026-10-02'), row('accepted', '2026-10-06', 'ACCEPTED'),
    row('rejected', '2026-10-07', 'REJECTED'), row('other-teacher', '2026-10-08', 'PENDING', 'other'),
    row('other-request', '2026-10-09', 'PENDING', 'teacher', 'other'), row('future', '2026-10-12'),
  ];
  assert.deepEqual(getPendingAssignmentConfirmations(first, days, '2026-10-05').map(a => a.id), ['a', 'future']);
  assert.deepEqual(getPendingAssignmentConfirmations(first, days, '2026-10-20'), []);
});

test('group confirmation uses the Berlin calendar day across midnight', () => {
  const first = row('a', '2026-10-04T22:30:00.000Z');
  assert.deepEqual(getPendingAssignmentConfirmations(first, [first], '2026-10-05'), [first]);
});

const block = (id: string, lessons: number[], overrides = {}) => ({
  ...row(id, '2026-11-05', 'PENDING', 'teacher', `request-${id}`),
  hours: lessons.length, lessonHours: JSON.stringify(lessons),
  request: { schoolId: 'school', locationId: null as string | null, status: 'FILLED' },
  ...overrides,
});

test('day plan combines sorted same-site blocks, counts six hours, and preserves accepted blocks', () => {
  const morning = block('morning', [1, 2, 3], { status: 'ACCEPTED' });
  const afternoon = block('afternoon', [4, 5, 6]);
  const rows = [afternoon, block('tomorrow', [1, 2], { date: '2026-11-06' }), morning,
    block('cancelled', [7], { status: 'CANCELLED' }), block('rejected', [8], { status: 'REJECTED' }),
    block('other-site', [9], { request: { schoolId: 'school', locationId: 'annex', status: 'FILLED' } }),
    block('other-school', [9], { request: { schoolId: 'other', locationId: null, status: 'FILLED' } }),
    block('other-teacher', [9], { teacherId: 'another' }),
    block('cancelled-request', [9], { request: { schoolId: 'school', locationId: null, status: 'CANCELLED' } }),
  ];
  const day = getAssignmentDayPlan(afternoon, rows);
  assert.deepEqual(day.map(item => item.id), ['morning', 'afternoon']);
  assert.equal(day.reduce((sum, item) => sum + item.hours, 0), 6);
  assert.equal(isValidDayConfirmation(afternoon, day), true);
});

test('day confirmation rejects wrong date/site/teacher, unknown slots, overlaps and duplicate requests', () => {
  const first = block('first', [1, 2, 3]);
  for (const other of [
    block('other', [3, 4, 5]),
    block('other', [4, 5, 6], { lessonHours: null }),
    block('other', [4, 5, 6], { requestId: first.requestId }),
    block('other', [4, 5, 6], { date: '2026-11-06' }),
    block('other', [4, 5, 6], { teacherId: 'other' }),
    block('other', [4, 5, 6], { request: { schoolId: 'school', locationId: 'annex', status: 'FILLED' } }),
  ]) assert.equal(isValidDayConfirmation(first, [first, other]), false, JSON.stringify(other));
  assert.equal(isValidDayConfirmation(first, []), false);
  assert.equal(isValidDayConfirmation(first, [block('other', [4, 5, 6])]), false);
  assert.equal(isValidDayConfirmation(first, [first]), true);
});
