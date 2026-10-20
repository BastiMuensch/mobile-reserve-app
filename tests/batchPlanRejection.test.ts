import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBatchRejection, batchRejectionDays, canRejectBatchRequest, updateBatchExclusionsAfterRejection } from '@/lib/batchPlanRejection';
import { makeApprovalPayload, makeRecalculationPayload } from '@/lib/batchPlanClient';

const days = [{ date: '2026-10-20', hours: 5 }, { date: '2026-10-21', hours: 4 }];
const school = {
  schoolId: 'school',
  proposals: [{
    requestId: 'request-a',
    segments: [
      { teacherId: 'reserve-a', entries: [{ date: days[0].date, hours: 3 }] },
      { teacherId: 'reserve-b', entries: [{ date: days[1].date, hours: 4 }] },
    ],
    coverage: { assignedHours: 7, requiredHours: 9, cancelledHours: 2 },
  }, {
    requestId: 'request-b',
    segments: [{ teacherId: 'reserve-c', entries: [{ date: days[0].date, hours: 5 }] }],
    coverage: { assignedHours: 5, requiredHours: 5, cancelledHours: 0 },
  }],
  unfillable: [{ requestId: 'request-c', reason: 'Keine passende Lehrkraft verfügbar.' }],
  coverage: { assignedHours: 12, requiredHours: 20, filledRequests: 2, totalRequests: 3, cancelledHours: 2 },
};

test('refusal only admits known open preview dates or all those dates', () => {
  assert.deepEqual(batchRejectionDays(days, 'all'), days);
  assert.deepEqual(batchRejectionDays(days, days[0].date), [days[0]]);
  assert.deepEqual(batchRejectionDays(days, '2026-11-01'), []);
});

test('only explicitly deselected proposals or unfillable requests may be refused', () => {
  assert.equal(canRejectBatchRequest(school, 'request-a', { 'request-a': true }, new Set()), false);
  assert.equal(canRejectBatchRequest(school, 'request-a', {}, new Set()), false);
  assert.equal(canRejectBatchRequest(school, 'request-a', { 'request-a': false }, new Set()), true);
  assert.equal(canRejectBatchRequest(school, 'request-a', { 'request-a': false }, new Set(['request-a'])), false);
  assert.equal(canRejectBatchRequest(school, 'request-c', {}, new Set()), true);
  assert.equal(canRejectBatchRequest(school, 'unknown', {}, new Set()), false);
});

test('whole-preview refusal removes the deselected proposal and updates all coverage totals', () => {
  const after = applyBatchRejection(school, 'request-a', days.map(day => day.date), days, true);
  assert.equal(after.proposals.length, 1);
  assert.equal(after.proposals[0], school.proposals[1], 'another selected proposal is preserved exactly');
  assert.deepEqual(after.coverage, { assignedHours: 5, requiredHours: 11, filledRequests: 1, totalRequests: 2, cancelledHours: 0 });
  assert.equal(school.proposals.length, 2, 'previous snapshot must remain immutable');
  const payload = makeApprovalPayload(after, { 'request-a': false, 'request-b': true }, {}, '2026/2027', '2026-10-22');
  assert.deepEqual(payload.items.map(item => item.requestId), ['request-b']);
});

test('partial refusal retains only remaining proposal days and does not move a teacher swap', () => {
  const after = applyBatchRejection(school, 'request-a', [days[0].date], days, true);
  assert.deepEqual(after.proposals[0].coverage, { assignedHours: 4, requiredHours: 4, cancelledHours: 0 });
  assert.deepEqual(after.proposals[0].segments[0].entries, []);
  const payload = makeApprovalPayload(after, { 'request-a': true }, {
    'request-a:0': { teacherId: 'wrong-swap', teacherName: 'Removed' },
    'request-a:1': { teacherId: 'correct-swap', teacherName: 'Remaining' },
  }, '2026/2027', '2026-10-22');
  assert.deepEqual(payload.items[0].segments, [{ teacherId: 'correct-swap', entries: [{ date: days[1].date, hours: 4 }] }]);
});

test('remaining shortage cancellation follows only remaining staffed days', () => {
  const after = applyBatchRejection(school, 'request-a', [days[1].date], days, true);
  assert.deepEqual(after.proposals[0].coverage, { assignedHours: 3, requiredHours: 5, cancelledHours: 2 });
  const normalMode = applyBatchRejection(school, 'request-a', [days[1].date], days, false);
  assert.equal(normalMode.proposals[0].coverage.cancelledHours, 0);
});

test('remaining unstaffed days stay visible if every proposed day was refused', () => {
  const extraDay = { date: '2026-10-22', hours: 2 };
  const after = applyBatchRejection(school, 'request-a', days.map(day => day.date), [...days, extraDay], false);
  assert.equal(after.proposals.some(proposal => proposal.requestId === 'request-a'), false);
  assert.equal(after.unfillable.some(entry => entry.requestId === 'request-a'), true);
  assert.equal(after.coverage.totalRequests, 3);
  const excludedRequestIds = updateBatchExclusionsAfterRejection([], 'request-a', [extraDay], true);
  const payload = makeRecalculationPayload({
    schools: [after], selected: { 'request-a': false, 'request-b': true }, swaps: {},
    excludedRequestIds, approvedPayloads: [], schoolYear: '2026/2027', until: extraDay.date,
    expectedReserveShortageMode: false,
  });
  assert.deepEqual(payload.excludedRequestIds, ['request-a'], 'remaining days of a deselected need must not be automatically reconsidered');
});

test('a complete refusal clears an exclusion and a partial refusal does not newly defer an unfillable need', () => {
  assert.deepEqual(updateBatchExclusionsAfterRejection(['request-a', 'request-b'], 'request-a', [], true), ['request-b']);
  assert.deepEqual(updateBatchExclusionsAfterRejection(['request-b'], 'request-a', days, false), ['request-b']);
  assert.deepEqual(updateBatchExclusionsAfterRejection(['request-a', 'request-b'], 'request-a', days, false), ['request-a', 'request-b']);
});

test('partially refusing an unfillable requirement preserves its reason and remaining totals', () => {
  const unfillableDays = [{ date: days[0].date, hours: 4 }, { date: days[1].date, hours: 2 }];
  const after = applyBatchRejection(school, 'request-c', [days[0].date], unfillableDays, true);
  assert.deepEqual(after.unfillable, school.unfillable);
  assert.equal(after.coverage.requiredHours, 16);
  assert.equal(after.coverage.totalRequests, 3);
  const final = applyBatchRejection(after, 'request-c', [days[1].date], [unfillableDays[1]], true);
  assert.equal(final.unfillable.length, 0);
  assert.equal(final.coverage.requiredHours, 14);
  assert.equal(final.coverage.totalRequests, 2);
});
