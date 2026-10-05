import test from 'node:test';
import assert from 'node:assert/strict';
import { getPendingAssignmentConfirmations } from '../src/lib/assignmentConfirmation';

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
