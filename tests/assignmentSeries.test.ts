import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssignmentSeries } from '../src/lib/assignmentSeries';

const row = (id: string, date: string, status = 'PENDING', hours = 4) => ({ id, date, status, hours });
test('proof uses only actual consecutive assigned teaching days and variable hours', () => {
  const rows = [row('a', '2026-09-10'), row('b', '2026-09-11', 'ACCEPTED', 2), row('c', '2026-09-14')];
  assert.deepEqual(getAssignmentSeries(rows[1], rows).map(a => a.id), ['a', 'b', 'c']);
  assert.equal(getAssignmentSeries(rows[1], rows).reduce((sum, a) => sum + a.hours, 0), 10);
});
test('proof does not bridge missing or cancelled teaching days', () => {
  const rows = [row('a', '2026-09-07'), row('b', '2026-09-08', 'REJECTED'), row('c', '2026-09-09')];
  assert.deepEqual(getAssignmentSeries(rows[0], rows).map(a => a.id), ['a']);
  assert.deepEqual(getAssignmentSeries(rows[1], rows).map(a => a.id), ['b']);
  assert.deepEqual(getAssignmentSeries(rows[2], rows).map(a => a.id), ['c']);
});
