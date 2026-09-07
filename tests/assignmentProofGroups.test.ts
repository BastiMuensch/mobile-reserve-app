import assert from 'node:assert/strict';
import test from 'node:test';
import { groupAssignmentProofs } from '../src/lib/assignmentProofGroups';
import { getAssignmentSeries } from '../src/lib/assignmentSeries';

const row = (id: string, date: string, extras = {}) => ({ id, date, hours: 3, status: 'ACCEPTED', requestId: 'request-a', teacherId: 'teacher-a', ...extras });

test('consecutive teaching days produce one proof, including across a weekend', () => {
  const rows = [row('mon', '2026-09-14'), row('fri', '2026-09-11')];
  const original = JSON.stringify(rows);
  const groups = groupAssignmentProofs(rows);
  assert.deepEqual(groups.map(g => g.map(r => r.id)), [['fri', 'mon']]);
  assert.equal(JSON.stringify(rows), original, 'Input order remains unchanged');
});

test('cancellations and missing teaching days split proofs', () => {
  const groups = groupAssignmentProofs([
    row('a', '2026-09-07'), row('b', '2026-09-08'),
    row('c', '2026-09-09', { status: 'REJECTED' }), row('d', '2026-09-10'),
    row('e', '2026-09-14'),
  ]);
  assert.deepEqual(groups.map(g => g.map(r => r.id)), [['e'], ['d'], ['c'], ['a', 'b']]);
});

test('different requests and school-year teacher rows never merge', () => {
  const groups = groupAssignmentProofs([
    row('a', '2026-09-07'), row('b', '2026-09-08', { requestId: 'request-b' }),
    row('c', '2026-09-08', { teacherId: 'teacher-b' }),
  ]);
  assert.equal(groups.length, 3);
});

test('every link anchor produces exactly its displayed PDF group', () => {
  const rows = [row('a', '2026-09-07', { status: 'PENDING' }), row('b', '2026-09-08'), row('c', '2026-09-10')];
  for (const group of groupAssignmentProofs(rows)) {
    assert.deepEqual(group, getAssignmentSeries(group[0], rows.filter(r => r.teacherId === group[0].teacherId && r.requestId === group[0].requestId)));
  }
});

test('empty data produces no download links', () => {
  assert.deepEqual(groupAssignmentProofs([]), []);
});
