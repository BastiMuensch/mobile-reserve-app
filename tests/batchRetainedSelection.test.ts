import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBatchProposal, type BatchInput, type BatchRequest, type BatchTeacher } from '@/lib/batchMatching';
import { batchPreviewSchema, RetainedBatchSelectionConflict } from '@/lib/batchPlanning';

const day = '2026-10-20';
const nextDay = '2026-10-21';
const school = { id: 'school', name: 'Testschule', latitude: 48.1, longitude: 11.5 };
const teacher = (id: string): BatchTeacher => ({
  id, name: id, status: 'ACTIVE', stammschuleId: school.id, maxWeeklyHours: 28,
  isPartTime: false, qualifications: '', preferredType: 'BOTH', homeLat: 48.1, homeLng: 11.5,
  schoolYear: '2026/2027', assignments: [],
});
const request = (id: string, hours = 5): BatchRequest => ({
  id, schoolId: school.id, date: day, hours, weeklyHours: hours, startHour: 1,
  qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: id, status: 'PENDING',
});
const base: BatchInput = {
  schools: [school], today: new Date(`${day}T09:00:00Z`), until: nextDay, schoolYear: '2026/2027',
  teachers: [teacher('a'), teacher('b')], requests: [request('first'), request('unchecked'), request('waiting')],
  absences: [], leavePeriods: [],
};
const retained = { requestId: 'first', segments: [{ teacherId: 'b', entries: [{ date: day, hours: 5 }] }] };

test('retained effective teacher stays fixed while excluded capacity moves to another requirement', () => {
  const result = buildBatchProposal({ ...base, retainedItems: [retained], excludedRequestIds: ['unchecked'] })[0];
  const fixed = result.proposals.find(proposal => proposal.requestId === 'first')!;
  assert.deepEqual(fixed.segments.map(({ teacherId, entries }) => ({ teacherId, entries })), retained.segments);
  assert.equal(result.proposals.find(proposal => proposal.requestId === 'waiting')?.segments[0].teacherId, 'a');
  assert.deepEqual(result.unfillable, [{ requestId: 'unchecked', reason: 'Für diese Berechnung zurückgestellt.' }]);
  assert.deepEqual(result.coverage, { filledRequests: 2, totalRequests: 3, assignedHours: 10, requiredHours: 15 });
});

test('retained partial hours and days are never silently topped up', () => {
  const item = { requestId: 'first', segments: [{ teacherId: 'b', entries: [{ date: day, hours: 2 }] }] };
  const result = buildBatchProposal({
    ...base, requests: [{ ...request('first'), endDate: nextDay }], retainedItems: [item], reserveShortageMode: true,
  })[0].proposals[0];
  assert.deepEqual(result.segments[0].entries, item.segments[0].entries);
  assert.deepEqual(result.coverage, { assignedHours: 2, requiredHours: 10, cancelledHours: 3 });
});

test('scarcity repair cannot move a retained flexible teacher away from a selected need', () => {
  const result = buildBatchProposal({
    ...base,
    teachers: [{ ...teacher('a'), isPartTime: true, schedule: '{"2":[1,2]}' }, teacher('b')],
    requests: [request('first', 2), { ...request('waiting', 2), startHour: 4 }],
    retainedItems: [{ requestId: 'first', segments: [{ teacherId: 'b', entries: [{ date: day, hours: 2 }] }] }],
  })[0];
  assert.equal(result.proposals[0].segments[0].teacherId, 'b');
  assert.deepEqual(result.unfillable.map(entry => entry.requestId), ['waiting']);
});

test('fixed reservations participate in week load before new candidates are ranked', () => {
  const result = buildBatchProposal({
    ...base, teachers: [{ ...teacher('a'), maxWeeklyHours: 5 }, { ...teacher('b'), maxWeeklyHours: 5 }],
    requests: [request('first'), { ...request('waiting'), date: nextDay }],
    retainedItems: [{ requestId: 'first', segments: [{ teacherId: 'a', entries: [{ date: day, hours: 5 }] }] }],
  })[0];
  assert.equal(result.proposals.find(proposal => proposal.requestId === 'waiting')?.segments[0].teacherId, 'b');
});

test('actual approved assignments and fixed reservations both block new double bookings', () => {
  const result = buildBatchProposal({
    ...base, teachers: [{ ...teacher('a'), assignments: [{ date: day, hours: 5, status: 'PENDING' }] }, teacher('b')],
    requests: [request('first'), request('waiting')], retainedItems: [retained],
  })[0];
  assert.deepEqual(result.unfillable.map(entry => entry.requestId), ['waiting']);
});

test('stale fixed selections fail as a whole for booking, absence, leave, timetable, ownership scope and period changes', () => {
  const cases: Partial<BatchInput>[] = [
    { teachers: [teacher('a')] },
    { teachers: [teacher('a'), { ...teacher('b'), status: 'INACTIVE' }] },
    { teachers: [teacher('a'), { ...teacher('b'), schoolYear: '2025/2026' }] },
    { teachers: [teacher('a'), { ...teacher('b'), onlyStammschule: true, stammschuleId: 'other' }] },
    { teachers: [teacher('a'), { ...teacher('b'), assignments: [{ date: day, hours: 1, status: 'ACCEPTED' }] }] },
    { teachers: [teacher('a'), { ...teacher('b'), isPartTime: true, schedule: '{"2":[1,2]}' }] },
    { absences: [{ teacherId: 'b', date: new Date(day) }] },
    { leavePeriods: [{ teacherId: 'b', startDate: new Date(day), endDate: null }] },
    { requests: [{ ...request('first'), status: 'CANCELLED' }] },
    { requests: [{ ...request('first'), hours: 4 }] },
    { requests: [{ ...request('first'), unfilledDays: JSON.stringify([{ date: day, reason: null, decidedAt: `${day}T09:00:00Z` }]) }] },
    { until: '2026-10-19' },
    { schoolYear: '2025/2026' },
  ];
  for (const override of cases) {
    assert.throws(() => buildBatchProposal({ ...base, ...override, retainedItems: [retained] }), RetainedBatchSelectionConflict, JSON.stringify(override));
  }
});

test('duplicate request days and cross-request teacher/day collisions cannot be retained', () => {
  assert.throws(() => buildBatchProposal({ ...base, retainedItems: [retained, { ...retained, requestId: 'waiting' }] }), RetainedBatchSelectionConflict);
  assert.throws(() => buildBatchProposal({ ...base, retainedItems: [{ ...retained, segments: [...retained.segments, { ...retained.segments[0], teacherId: 'a' }] }] }), RetainedBatchSelectionConflict);
});

test('preview schema rejects duplicates, intersecting retained/excluded IDs and malformed entries', () => {
  const requestId = '00000000-0000-4000-8000-000000000001';
  const teacherId = '00000000-0000-4000-8000-000000000002';
  const item = { requestId, segments: [{ teacherId, entries: [{ date: day, hours: 5 }] }] };
  const valid = { schoolYear: '2026/2027', until: nextDay, retainedItems: [item] };
  assert.equal(batchPreviewSchema.safeParse(valid).success, true);
  assert.equal(batchPreviewSchema.safeParse({ ...valid, excludedRequestIds: [requestId] }).success, false);
  assert.equal(batchPreviewSchema.safeParse({ ...valid, retainedItems: [item, item] }).success, false);
  assert.equal(batchPreviewSchema.safeParse({ ...valid, retainedItems: [], excludedRequestIds: [requestId, requestId] }).success, false);
  assert.equal(batchPreviewSchema.safeParse({ ...valid, retainedItems: [{ ...item, segments: [] }] }).success, false);
  assert.equal(batchPreviewSchema.safeParse({ ...valid, retainedItems: [{ ...item, segments: [{ teacherId, entries: [{ date: day, hours: 0 }] }] }] }).success, false);
});
