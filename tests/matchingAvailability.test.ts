import assert from 'node:assert/strict';
import test from 'node:test';
import { rankCandidates, type TeacherAssignmentForMatching } from '../src/lib/matching';
import { buildBatchProposal, type BatchRequest } from '../src/lib/batchMatching';

const school = { id: 'school', name: 'Testschule', latitude: 48.1, longitude: 11.5 };
const request: BatchRequest = {
  id: 'request', schoolId: school.id, date: new Date('2026-10-12T00:00:00Z'),
  endDate: null, hours: 6, weeklyHours: 6, startHour: 1, qualifications: 'Grundschule',
  schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Test', status: 'PENDING',
};

function assignment(date: string, hours: number, requestStatus = 'FILLED'): TeacherAssignmentForMatching {
  return {
    date: new Date(`${date}T00:00:00Z`), hours, status: 'ACCEPTED', requestId: 'other-request',
    request: { schoolId: school.id, status: requestStatus },
  };
}

function teacher(id = 'teacher', assignments: TeacherAssignmentForMatching[] = []) {
  return {
    id, name: id, status: 'ACTIVE', stammschuleId: school.id, onlyStammschule: false,
    maxWeeklyHours: 28, isPartTime: false, qualifications: 'Grundschule', preferredType: 'BOTH',
    homeLat: 48.1, homeLng: 11.5, schoolYear: '2026/2027', assignments,
    qualificationType: null, canTeachSports: null, email: null, phone: null, userId: null,
    schedule: null as string | null, gender: null, address: '', postalCode: '',
  };
}

function rank(
  teachers: ReturnType<typeof teacher>[], demand: BatchRequest = request,
  openDays = ['2026-10-12'], absences: Parameters<typeof rankCandidates>[3] = [],
  leaves: Parameters<typeof rankCandidates>[4] = [],
) {
  return rankCandidates(
    demand as Parameters<typeof rankCandidates>[0], school as Parameters<typeof rankCandidates>[1],
    teachers, absences, leaves, openDays,
  );
}

test('individual ranking includes the complete new demand in weekly overtime and prioritizes a safe reserve', () => {
  const overloaded = teacher('overloaded', [assignment('2026-10-13', 24)]);
  const safe = { ...teacher('safe'), stammschuleId: 'other' };
  const candidates = rank([overloaded, safe]);
  assert.equal(candidates[0].id, 'safe');
  assert.equal(candidates[0].isOvertime, false);
  assert.equal(candidates[1].isOvertime, true);
  assert.equal(candidates[1].assignedHours, 24);
  assert.equal(rank([teacher('at-limit', [assignment('2026-10-13', 22)])])[0].isOvertime, false);
});

test('all proposed days are added per week, without pooling hours from separate weeks', () => {
  const demand = { ...request, endDate: new Date('2026-10-20T00:00:00Z') };
  const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
  assert.equal(rank([teacher()], demand, days)[0].isOvertime, true);
  assert.equal(rank([teacher()], demand, ['2026-10-12', '2026-10-13', '2026-10-19', '2026-10-20'])[0].isOvertime, false);
});

test('partially filled demand adds only its remaining hours and excludes rejected prior bookings', () => {
  const reserve = teacher('remaining-capacity', [assignment('2026-10-13', 26)]);
  const partial = {
    ...request, assignments: [assignment('2026-10-12', 4)], status: 'PARTIALLY_FILLED',
  };
  assert.equal(rank([reserve], partial)[0].isOvertime, false);
  assert.equal(rank([reserve], { ...partial, assignments: [{ ...assignment('2026-10-12', 4), status: 'REJECTED' }] })[0].isOvertime, true);
});

test('fully filled historic weeks do not label an open later week as overtime', () => {
  const reserve = teacher('later', [assignment('2026-10-12', 28)]);
  const demand = { ...request, endDate: new Date('2026-10-20T00:00:00Z') };
  const candidate = rank([reserve], demand, ['2026-10-19', '2026-10-20'])[0];
  assert.equal(candidate.assignedHours, 0);
  assert.equal(candidate.isOvertime, false);
});

test('cross-year candidates are charged only the new hours of their own school-year days', () => {
  const demand = { ...request, date: new Date('2026-08-31T00:00:00Z'), endDate: new Date('2026-09-01T00:00:00Z'), hours: 4 };
  const candidates = rank([
    { ...teacher('old-year'), schoolYear: '2025/2026', maxWeeklyHours: 4 },
    { ...teacher('new-year'), maxWeeklyHours: 4 },
  ], demand, ['2026-08-31', '2026-09-01']);
  assert.deepEqual(candidates.map(candidate => [candidate.id, candidate.eligibleDateKeys, candidate.isOvertime]), [
    ['old-year', ['2026-08-31'], false], ['new-year', ['2026-09-01'], false],
  ]);
});

test('individual matching offers only the unaffected full days of a partially absent reserve', () => {
  const demand = { ...request, endDate: new Date('2026-10-16T00:00:00Z'), hours: 2 };
  const reserve = { ...teacher(), isPartTime: true, schedule: JSON.stringify({ '1': [1, 2], '2': [1, 2], '3': [1], '4': [1, 2], '5': [1, 2] }) };
  const candidates = rank([reserve], demand,
    ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'],
    [{ teacherId: reserve.id, date: new Date('2026-10-12T00:00:00Z') }],
    [{ teacherId: reserve.id, startDate: new Date('2026-10-13T00:00:00Z'), endDate: new Date('2026-10-13T00:00:00Z') }],
  );
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].eligibleDateKeys, ['2026-10-15', '2026-10-16']);
  assert.equal(candidates[0].isOvertime, false);
});

test('an ongoing request checks the actual supplied days against every required part-time slot', () => {
  const demand = { ...request, date: new Date('2030-01-01T00:00:00Z'), isOpenEnded: true, hours: 2 };
  const reserve = {
    ...teacher(), schoolYear: '2029/2030', isPartTime: true,
    schedule: JSON.stringify({ '1': [1, 2] }),
  };
  // These days are later than the request's initial rolling horizon.
  const candidates = rank([reserve], demand, ['2030-02-04', '2030-02-05']);
  assert.deepEqual(candidates[0].eligibleDateKeys, ['2030-02-04']);
});

test('weekend-only demand never bypasses a weekday-only part-time schedule', () => {
  const saturday = { ...request, date: new Date('2026-10-17T00:00:00Z'), hours: 2 };
  const reserve = { ...teacher(), isPartTime: true, schedule: JSON.stringify({ '1': [1, 2] }) };
  assert.deepEqual(rank([reserve], saturday, ['2026-10-17']), []);
});

test('cancelled request history occupies neither days nor weekly capacity in individual and batch matching', () => {
  const reserve = teacher('free-after-cancellation', [
    assignment('2026-10-12', 6, 'CANCELLED'), assignment('2026-10-13', 28, 'CANCELLED'),
  ]);
  const candidates = rank([reserve]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].assignedHours, 0);
  assert.equal(candidates[0].isOvertime, false);
  const result = buildBatchProposal({
    today: new Date('2026-10-12T00:00:00Z'), until: '2026-10-12', schools: [school],
    teachers: [reserve], requests: [request], absences: [], leavePeriods: [],
  });
  assert.equal(result[0].proposals[0].segments[0].teacherId, reserve.id);
  assert.equal(result[0].proposals[0].segments[0].warnings, undefined);
});

test('closed requests have no individual matching candidates', () => {
  for (const status of ['CANCELLED', 'FILLED', 'UNFILLED']) {
    assert.deepEqual(rank([teacher()], { ...request, status }), []);
  }
});

test('batch alternatives retain safe candidates before higher-base-score overtime candidates', () => {
  const safe = { ...teacher('safe-alternative'), stammschuleId: 'other' };
  const overloaded = Array.from({ length: 5 }, (_, index) =>
    teacher(`overloaded-${index}`, [assignment('2026-10-13', 24)]));
  const result = buildBatchProposal({
    today: new Date('2026-10-12T00:00:00Z'), until: '2026-10-12', schools: [school],
    teachers: [teacher('chosen'), ...overloaded, safe], requests: [request], absences: [], leavePeriods: [],
  });
  const segment = result[0].proposals[0].segments[0];
  assert.equal(segment.teacherId, 'chosen');
  assert.equal(segment.alternatives.length, 5);
  assert.equal(segment.alternatives[0].teacherId, safe.id);
  assert.equal(segment.alternatives[0].warnings, undefined);
  assert.ok(segment.alternatives.slice(1).every(candidate => candidate.reasons.includes('Mehrarbeit')));
});
