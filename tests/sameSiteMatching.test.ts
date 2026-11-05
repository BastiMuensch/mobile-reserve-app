import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAssignmentBookingConflict, type BookingAssignment } from '../src/lib/assignmentBooking';
import { buildBatchProposal, type BatchInput, type BatchRequest, type BatchTeacher } from '../src/lib/batchMatching';
import { rankCandidates } from '../src/lib/matching';

const date = '2026-11-09';
const school = { id: 'school', name: 'Schule', latitude: 48.1, longitude: 11.5 };
const morning: BatchRequest = {
  id: 'morning', schoolId: school.id, locationId: null, date, startHour: 1, hours: 3, weeklyHours: 3,
  schoolType: 'GRUNDSCHULE', qualifications: '', substitutedTeacher: 'A', status: 'PENDING', assignments: [],
};
const afternoon: BatchRequest = { ...morning, id: 'afternoon', startHour: 4, substitutedTeacher: 'B' };
const teacher: BatchTeacher = {
  id: 'reserve', name: 'Reserve', status: 'ACTIVE', stammschuleId: school.id, maxWeeklyHours: 28,
  isPartTime: false, qualifications: 'Alles', preferredType: 'BOTH', homeLat: 48.1, homeLng: 11.5,
  schoolYear: '2026/2027', assignments: [],
};
const booked: BookingAssignment & { status: string } = {
  date, hours: 3, lessonHours: '[1,2,3]', status: 'ACCEPTED', requestId: morning.id,
  request: { schoolId: school.id, locationId: null },
};
const proposed = {
  date, hours: 3, lessonHours: '[4,5,6]', requestId: afternoon.id, schoolId: school.id, locationId: null,
};
const base: BatchInput = {
  today: new Date(date), until: date, schools: [school], teachers: [teacher],
  requests: [morning, afternoon], absences: [], leavePeriods: [], schoolYear: '2026/2027',
};

test('a short assignment keeps its day lock except for a proven disjoint same-site request', () => {
  assert.equal(hasAssignmentBookingConflict([booked], proposed), false);
  for (const changed of [
    { ...proposed, schoolId: 'other-school' },
    { ...proposed, locationId: 'branch' },
    { ...proposed, lessonHours: '[3,4,5]' },
    { ...proposed, lessonHours: null },
    { ...proposed, requestId: morning.id },
  ]) assert.equal(hasAssignmentBookingConflict([booked], changed), true);
  for (const changed of [
    { ...booked, lessonHours: undefined },
    { ...booked, lessonHours: '[1,2]' },
    { ...booked, request: undefined },
    { ...booked, requestId: undefined },
  ]) assert.equal(hasAssignmentBookingConflict([changed], proposed), true);
  assert.equal(hasAssignmentBookingConflict([{ ...booked, status: 'REJECTED' }], { ...proposed, schoolId: 'other' }), false);
  assert.equal(hasAssignmentBookingConflict([{ ...booked, request: { ...booked.request!, status: 'CANCELLED' } }], proposed), false);
});

test('same-site exception never ignores another booking on the day', () => {
  const second = { ...booked, requestId: afternoon.id, lessonHours: '[4,5,6]' };
  assert.equal(hasAssignmentBookingConflict([booked, second], { ...proposed, requestId: 'third', lessonHours: '[6,7,8]' }), true);
  assert.equal(hasAssignmentBookingConflict([booked, second], { ...proposed, requestId: 'third', lessonHours: '[7,8,9]' }), false);
});

function rank(request: BatchRequest, reserve = { ...teacher, assignments: [booked] }) {
  return rankCandidates(
    { ...request, date: new Date(date) } as unknown as Parameters<typeof rankCandidates>[0],
    school as Parameters<typeof rankCandidates>[1],
    [{ ...reserve, assignments: reserve.assignments.map(assignment => ({ ...assignment, date: new Date(assignment.date) })) }] as Parameters<typeof rankCandidates>[2], [], [], [date],
  );
}

test('individual matching offers the second block but preserves school and site day locks', () => {
  const candidates = rank(afternoon);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].availableHoursByDate, { [date]: 3 });
  assert.equal(candidates[0].assignedHours, 3);
  assert.ok(candidates[0].matchReasons.includes('Ergänzend am selben Standort einsetzbar'));
  assert.equal(rank({ ...afternoon, schoolId: 'other' }).length, 0);
  assert.equal(rank({ ...afternoon, locationId: 'branch' }).length, 0);
  assert.equal(rank({ ...afternoon, startHour: 3 }).length, 0);
  assert.equal(rank(afternoon, { ...teacher, assignments: [{ ...booked, lessonHours: null }] }).length, 0);
});

test('batch proposes one reserve for two separate requests and six total lessons', () => {
  const result = buildBatchProposal(base)[0];
  assert.equal(result.proposals.length, 2);
  assert.equal(result.coverage.assignedHours, 6);
  assert.equal(result.coverage.filledRequests, 2);
  assert.deepEqual(result.proposals.map(item => item.segments[0].teacherId), ['reserve', 'reserve']);
  assert.equal(result.unfillable.length, 0);
});

test('one three-lesson request keeps the reserve unavailable to another school or site', () => {
  for (const request of [
    { ...afternoon, schoolId: 'other' },
    { ...afternoon, locationId: 'branch' },
    { ...afternoon, startHour: 3 },
  ]) {
    const result = buildBatchProposal({ ...base, schools: [school, { ...school, id: 'other', name: 'Andere' }], requests: [morning, request] });
    assert.equal(result.flatMap(item => item.proposals).length, 1);
    assert.equal(result.flatMap(item => item.unfillable).length, 1);
  }
});

test('batch can complement a persisted known block; unknown legacy timing still locks the day', () => {
  const input = { ...base, requests: [afternoon], teachers: [{ ...teacher, assignments: [booked] }] };
  assert.equal(buildBatchProposal(input)[0].coverage.assignedHours, 3);
  assert.equal(buildBatchProposal({ ...input, teachers: [{ ...teacher, assignments: [{ ...booked, lessonHours: null }] }] })[0].proposals.length, 0);
});

test('partially filled demand uses only its persisted remaining lessons when combined with another request', () => {
  const partial = {
    ...morning, hours: 6, weeklyHours: 6, status: 'PARTIALLY_FILLED',
    assignments: [{ date, hours: 2, lessonHours: '[1,2]', status: 'ACCEPTED' }],
  };
  const companion = { ...afternoon, startHour: 1, hours: 2, weeklyHours: 2 };
  const result = buildBatchProposal({ ...base, requests: [partial, companion] })[0];
  assert.equal(result.coverage.assignedHours, 6);
  assert.deepEqual(result.proposals.find(item => item.requestId === partial.id)?.segments[0].entries,
    [{ date, hours: 4, lessonHours: '[3,4,5,6]' }]);
  assert.deepEqual(result.proposals.find(item => item.requestId === companion.id)?.segments[0].entries,
    [{ date, hours: 2, lessonHours: '[1,2]' }]);
  const legacyPartial = { ...partial, assignments: [{ date, hours: 2, status: 'ACCEPTED' }] };
  assert.equal(buildBatchProposal({ ...base, requests: [legacyPartial, companion] })[0].proposals.length, 1,
    'without the earlier assignment snapshot the four-hour proposal keeps the whole day locked');
});

test('retaining both compatible blocks preserves them through recalculation', () => {
  const retainedItems = [morning, afternoon].map(request => ({
    requestId: request.id, segments: [{ teacherId: teacher.id, entries: [{ date, hours: 3 }] }],
  }));
  const result = buildBatchProposal({ ...base, retainedItems })[0];
  assert.equal(result.coverage.assignedHours, 6);
  assert.equal(result.proposals.length, 2);
});

test('combining blocks sums weekly workload and respects part-time availability', () => {
  const result = buildBatchProposal({ ...base, teachers: [{ ...teacher, maxWeeklyHours: 5 }] })[0];
  assert.ok(result.proposals.every(item => item.segments[0].warnings?.some(warning => warning.includes('Mehrarbeit'))));
  const partTime = buildBatchProposal({ ...base, teachers: [{ ...teacher, isPartTime: true, schedule: '{"1":[1,2,3]}' }] })[0];
  assert.deepEqual(partTime.proposals.map(item => item.requestId), ['morning']);
  assert.equal(partTime.unfillable.length, 1);
});

test('absence and leave block both otherwise compatible requests', () => {
  const absent = buildBatchProposal({ ...base, absences: [{ teacherId: teacher.id, date: new Date(date) }] })[0];
  assert.equal(absent.proposals.length, 0);
  const leave = buildBatchProposal({ ...base, leavePeriods: [{ teacherId: teacher.id, startDate: new Date(date), endDate: null }] })[0];
  assert.equal(leave.proposals.length, 0);
});

test('optimizer repairs and swaps preserve site locks and disjoint lessons across mixed plans', () => {
  const schools = [school, { ...school, id: 'other', name: 'Andere Schule' }];
  for (let scenario = 0; scenario < 20; scenario++) {
    const teachers = Array.from({ length: 4 }, (_, index) => ({
      ...teacher, id: `reserve-${index}`, name: `Reserve ${index}`,
      stammschuleId: schools[index % 2].id,
      isPartTime: index === 0,
      schedule: '{"1":[1,2,3]}',
      maxWeeklyHours: 4 + index,
    }));
    const requests = Array.from({ length: 8 }, (_, index) => ({
      ...morning, id: `request-${index}`, schoolId: schools[(index + scenario) % 2].id,
      locationId: (index + scenario) % 5 === 0 ? 'branch' : null,
      location: (index + scenario) % 5 === 0 ? { name: 'Außenstelle', latitude: 48.1, longitude: 11.5 } : null,
      hours: 1 + ((index * 2 + scenario) % 3),
      startHour: 1 + ((index * 5 + scenario) % 6),
    }));
    const result = buildBatchProposal({ ...base, teachers, requests, schools });
    const requestsById = new Map(requests.map(request => [request.id, request]));
    const bookings = result.flatMap(item => item.proposals.flatMap(proposal => proposal.segments.flatMap(segment =>
      segment.entries.map(entry => ({ ...entry, teacherId: segment.teacherId, request: requestsById.get(proposal.requestId)! })))));
    assert.equal(new Set(bookings.map(booking => `${booking.request.id}:${booking.date}`)).size, bookings.length,
      'the optimizer proposes at most one segment per request/day, including partial fills');
    for (const [index, booking] of bookings.entries()) {
      const slots = JSON.parse(booking.lessonHours!) as number[];
      assert.equal(slots.length, booking.hours);
      assert.ok(slots.every(hour => hour >= booking.request.startHour && hour < booking.request.startHour + booking.request.hours));
      for (const other of bookings.slice(index + 1)) {
        if (booking.teacherId !== other.teacherId || booking.date !== other.date) continue;
        assert.equal(booking.request.schoolId, other.request.schoolId, `scenario ${scenario}: cross-school double booking`);
        assert.equal(booking.request.locationId, other.request.locationId, `scenario ${scenario}: cross-site double booking`);
        const otherSlots = JSON.parse(other.lessonHours!) as number[];
        assert.ok(slots.every(hour => !otherSlots.includes(hour)), `scenario ${scenario}: overlapping lessons`);
      }
    }
  }
});
