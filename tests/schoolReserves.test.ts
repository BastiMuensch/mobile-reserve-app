import assert from 'node:assert/strict';
import test from 'node:test';
import { groupReserveAssignments, type ReserveAssignmentInput } from '../src/lib/schoolReserves';

const input = (date: string, overrides: Partial<ReserveAssignmentInput> = {}): ReserveAssignmentInput => ({
  id: date, requestId: 'request', date: new Date(`${date}T00:00:00Z`), hours: 3, status: 'ACCEPTED', school: { id: 'destination', name: 'Einsatzschule' }, ...overrides,
});

test('reserve overview merges consecutive days but preserves weekends, gaps, hours and confirmation changes', () => {
  const groups = groupReserveAssignments([
    input('2026-10-16'), input('2026-10-15'), input('2026-10-19'),
    input('2026-10-20', { hours: 2 }), input('2026-10-21', { status: 'PENDING', hours: 2 }),
    input('2026-10-22', { status: 'REJECTED', hours: 2 }),
  ], '2026-10-01');
  assert.equal(groups.length, 5);
  assert.deepEqual(groups.map(row => [row.startDate, row.endDate, row.days]), [
    ['2026-10-15', '2026-10-16', 2], ['2026-10-19', '2026-10-19', 1],
    ['2026-10-20', '2026-10-20', 1], ['2026-10-21', '2026-10-21', 1], ['2026-10-22', '2026-10-22', 1],
  ]);
  assert.equal(groups[3].confirmation, 'PENDING');
  assert.equal(groups[4].phase, 'CANCELLED');
});

test('past, today, upcoming and cancelled remain distinct without hiding confirmation state', () => {
  const groups = groupReserveAssignments([
    input('2026-10-01', { status: 'PENDING' }), input('2026-10-02', { status: 'PENDING' }),
    input('2026-10-03'), input('2026-10-04', { status: 'REJECTED' }),
  ], '2026-10-02');
  assert.deepEqual(groups.map(row => row.phase), ['ENDED', 'CURRENT', 'PLANNED', 'CANCELLED']);
  assert.equal(groups[1].confirmation, 'PENDING');
});

test('separate requests and schools are never coalesced and no assignments is valid', () => {
  assert.deepEqual(groupReserveAssignments([], '2026-10-01'), []);
  const groups = groupReserveAssignments([
    input('2026-10-03'), input('2026-10-04', { requestId: 'other' }),
    input('2026-10-05', { requestId: 'other', school: { id: 'other-school', name: 'Andere Schule' } }),
  ], '2026-10-01');
  assert.equal(groups.length, 3);
  assert.ok(groups.every(row => !('requestId' in row)), 'request identity is unnecessary in the public DTO');
});
