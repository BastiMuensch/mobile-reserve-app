import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchProposal, type BatchTeacher } from '../src/lib/batchMatching';

const school = { id: 'school', name: 'Testschule', latitude: 48.1, longitude: 11.5 };

function teacher(id: string, schoolYear: string): BatchTeacher {
  return {
    id,
    name: id,
    status: 'ACTIVE',
    stammschuleId: 'school',
    maxWeeklyHours: 28,
    isPartTime: false,
    qualifications: 'Alles',
    preferredType: 'BOTH',
    homeLat: 48.1,
    homeLng: 11.5,
    schoolYear,
  };
}

test('batch matching splits a cross-school-year request into the teacher rows for its actual days', () => {
  const proposal = buildBatchProposal({
    today: new Date('2026-08-30T00:00:00.000Z'),
    until: new Date('2026-09-02T00:00:00.000Z'),
    schools: [school],
    teachers: [teacher('old-year', '2025/2026'), teacher('new-year', '2026/2027')],
    absences: [],
    leavePeriods: [],
    requests: [{
      id: 'request', schoolId: 'school', date: new Date('2026-08-31T00:00:00.000Z'),
      endDate: new Date('2026-09-01T00:00:00.000Z'), hours: 2, weeklyHours: 4,
      startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', status: 'PENDING',
    }],
  });

  const segments = proposal[0].proposals[0].segments;
  assert.deepEqual(segments.map(segment => [segment.teacherId, segment.entries[0].date]), [
    ['new-year', '2026-09-01'],
    ['old-year', '2026-08-31'],
  ]);
});

test('batch matching rejects equal-count but non-overlapping part-time lesson slots', () => {
  const proposal = buildBatchProposal({
    today: new Date('2026-05-03T00:00:00.000Z'),
    until: new Date('2026-05-04T00:00:00.000Z'),
    schools: [school],
    teachers: [{ ...teacher('part-time', '2025/2026'), isPartTime: true, schedule: JSON.stringify({ '1': [1, 2] }) }],
    absences: [], leavePeriods: [],
    requests: [{
      id: 'request', schoolId: 'school', date: new Date('2026-05-04T00:00:00.000Z'), hours: 2, weeklyHours: 2,
      startHour: 1, schedule: JSON.stringify({ '1': [4, 5] }), qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', status: 'PENDING',
    }],
  });

  assert.equal(proposal[0].proposals.length, 0);
  assert.equal(proposal[0].unfillable.length, 1);
});

test('batch matching never proposes days after the selected cutoff', () => {
  const proposal = buildBatchProposal({
    today: new Date('2026-09-20T00:00:00.000Z'),
    until: new Date('2026-09-21T00:00:00.000Z'),
    schools: [school], teachers: [teacher('current-year', '2026/2027')], absences: [], leavePeriods: [],
    requests: [{
      id: 'request', schoolId: 'school', date: new Date('2026-09-21T00:00:00.000Z'),
      endDate: new Date('2026-09-24T00:00:00.000Z'), hours: 2, weeklyHours: 8,
      startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', status: 'PENDING',
    }],
  });

  assert.deepEqual(proposal[0].proposals[0].segments.flatMap(segment => segment.entries.map(entry => entry.date)), ['2026-09-21']);
  assert.equal(proposal[0].proposals[0].coverage.requiredHours, 2);
});

test('batch matching does not stop after roughly half of five separately coverable days', () => {
  const dates = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
  const teachers = dates.map((_, index) => teacher(`teacher-${index}`, '2026/2027'));
  const absences = teachers.flatMap((item, teacherIndex) => dates
    .filter((_, dateIndex) => dateIndex !== teacherIndex)
    .map(date => ({ teacherId: item.id, date: new Date(`${date}T00:00:00.000Z`) })));

  const proposal = buildBatchProposal({
    today: new Date('2026-09-07T00:00:00.000Z'), until: new Date('2026-09-11T00:00:00.000Z'),
    schools: [school], teachers, absences, leavePeriods: [],
    requests: [{
      id: 'five-days', schoolId: 'school', date: new Date('2026-09-07T00:00:00.000Z'),
      endDate: new Date('2026-09-11T00:00:00.000Z'), hours: 1, weeklyHours: 5,
      startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', status: 'PENDING',
    }],
  });

  const filled = proposal[0].proposals[0];
  assert.equal(filled.coverage.assignedHours, 5);
  assert.equal(filled.segments.length, 5);
  assert.deepEqual(filled.segments.flatMap(segment => segment.entries.map(entry => entry.date)).sort(), dates);
});

test('batch matching reserves a flexible teacher for a later scarce lesson slot', () => {
  const schoolA = { ...school, id: 'a', name: 'A Schule' };
  const schoolB = { ...school, id: 'b', name: 'B Schule' };
  // The flexible teacher has the Stamm­schulbonus for A. Greedy score selection picks
  // them first, so the bounded augmenting repair must move A to the limited teacher
  // and free the flexible teacher for B's otherwise unfillable hour-2 need.
  const limited = { ...teacher('limited', '2025/2026'), stammschuleId: 'other', isPartTime: true, schedule: JSON.stringify({ '1': [1] }) };
  const flexible = { ...teacher('flexible', '2025/2026'), stammschuleId: 'a' };
  const proposal = buildBatchProposal({
    today: new Date('2026-05-04T00:00:00.000Z'), until: new Date('2026-05-04T00:00:00.000Z'),
    schools: [schoolA, schoolB], teachers: [limited, flexible], absences: [], leavePeriods: [],
    requests: [
      { id: 'a-hour-1', schoolId: 'a', date: new Date('2026-05-04T00:00:00.000Z'), hours: 1, weeklyHours: 1, startHour: 1, schedule: JSON.stringify({ '1': [1] }), qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', status: 'PENDING' },
      { id: 'b-hour-2', schoolId: 'b', date: new Date('2026-05-04T00:00:00.000Z'), hours: 1, weeklyHours: 1, startHour: 2, schedule: JSON.stringify({ '1': [2] }), qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'B', status: 'PENDING' },
    ],
  });

  const assignments = Object.fromEntries(proposal.flatMap(result => result.proposals.map(item => [item.requestId, item.segments[0].teacherId])));
  assert.deepEqual(assignments, { 'a-hour-1': 'limited', 'b-hour-2': 'flexible' });
});

test('batch matching carries open-ended metadata into urgency and excludes past days', () => {
  const requests = ['one', 'two', 'three'].map(id => ({
    id, schoolId: 'school', date: new Date('2026-05-01T00:00:00.000Z'), endDate: null,
    isOpenEnded: true, endedAt: null, hours: 1, weeklyHours: 5, startHour: 1,
    qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: id, status: 'PENDING',
  }));
  const proposal = buildBatchProposal({
    today: new Date('2026-05-04T00:00:00.000Z'), until: new Date('2026-05-05T00:00:00.000Z'),
    schools: [school], teachers: [teacher('one', '2025/2026'), teacher('two', '2025/2026'), teacher('three', '2025/2026')],
    absences: [], leavePeriods: [], requests,
  });

  const item = proposal[0].proposals[0];
  assert.ok(item.urgency.reasons.includes('Häufung'));
  assert.ok(!item.urgency.reasons.includes('Überfällig'));
  assert.deepEqual(item.segments.flatMap(segment => segment.entries.map(entry => entry.date)), ['2026-05-04', '2026-05-05']);
});

test('batch matching filters generated days to the selected school year', () => {
  const proposal = buildBatchProposal({
    today: new Date('2026-08-30T00:00:00.000Z'), until: new Date('2026-09-02T00:00:00.000Z'), schoolYear: '2026/2027',
    schools: [school], teachers: [teacher('current-year', '2026/2027')], absences: [], leavePeriods: [],
    requests: [{
      id: 'cross-year', schoolId: 'school', date: new Date('2026-08-31T00:00:00.000Z'), endDate: new Date('2026-09-01T00:00:00.000Z'),
      hours: 1, weeklyHours: 2, startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', status: 'PENDING',
    }],
  });

  assert.deepEqual(proposal[0].proposals[0].segments.flatMap(segment => segment.entries.map(entry => entry.date)), ['2026-09-01']);
});

test('batch matching computes alternatives from the final plan, not an earlier partial plan', () => {
  const proposal = buildBatchProposal({
    today: new Date('2026-05-04T00:00:00.000Z'), until: new Date('2026-05-04T00:00:00.000Z'),
    schools: [school], teachers: [teacher('first', '2025/2026'), teacher('second', '2025/2026')], absences: [], leavePeriods: [],
    requests: ['first-request', 'second-request'].map(id => ({
      id, schoolId: 'school', date: new Date('2026-05-04T00:00:00.000Z'), hours: 1, weeklyHours: 1,
      startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: id, status: 'PENDING',
    })),
  });

  const first = proposal[0].proposals.find(item => item.requestId === 'first-request')!;
  assert.equal(first.segments[0].teacherId, 'first');
  assert.deepEqual(first.segments[0].alternatives, []);
});

test('batch matching uses the Berlin calendar day for a near-midnight today and cutoff', () => {
  const proposal = buildBatchProposal({
    // 00:30 in Berlin on 4 May, while this is still 3 May in UTC.
    today: new Date('2026-05-03T22:30:00.000Z'), until: new Date('2026-05-03T22:30:00.000Z'),
    schools: [school], teachers: [teacher('berlin-day', '2025/2026')], absences: [], leavePeriods: [],
    requests: [{
      id: 'near-midnight', schoolId: 'school', date: new Date('2026-05-03T00:00:00.000Z'), endDate: new Date('2026-05-04T00:00:00.000Z'),
      hours: 1, weeklyHours: 2, startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', status: 'PENDING',
    }],
  });

  assert.deepEqual(proposal[0].proposals[0].segments.flatMap(segment => segment.entries.map(entry => entry.date)), ['2026-05-04']);
});

test('batch matching excludes fixed historical requests and respects an open-ended endedAt cutoff', () => {
  const proposal = buildBatchProposal({
    today: new Date('2026-05-04T00:00:00.000Z'), until: new Date('2026-05-08T00:00:00.000Z'),
    schools: [school], teachers: [teacher('current', '2025/2026')], absences: [], leavePeriods: [],
    requests: [
      { id: 'historical', schoolId: 'school', date: new Date('2026-05-01T00:00:00.000Z'), endDate: new Date('2026-05-02T00:00:00.000Z'), hours: 1, weeklyHours: 2, startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', status: 'PENDING' },
      { id: 'returned', schoolId: 'school', date: new Date('2026-05-01T00:00:00.000Z'), endDate: null, isOpenEnded: true, endedAt: new Date('2026-05-05T00:00:00.000Z'), hours: 1, weeklyHours: 5, startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'B', status: 'PENDING' },
    ],
  });

  assert.equal(proposal.length, 1);
  assert.equal(proposal[0].coverage.totalRequests, 1);
  assert.deepEqual(proposal[0].proposals[0].segments.flatMap(segment => segment.entries.map(entry => entry.date)), ['2026-05-04', '2026-05-05']);
});

test('batch matching prefers a non-overtime candidate even with a lower base match score', () => {
  const overtime = { ...teacher('overtime', '2025/2026'), maxWeeklyHours: 1, assignments: [{ date: new Date('2026-05-05T00:00:00.000Z'), hours: 1, status: 'ACCEPTED' }] };
  const safe = { ...teacher('safe', '2025/2026'), stammschuleId: 'other' };
  const proposal = buildBatchProposal({
    today: new Date('2026-05-04T00:00:00.000Z'), until: new Date('2026-05-04T00:00:00.000Z'),
    schools: [school], teachers: [overtime, safe], absences: [], leavePeriods: [],
    requests: [{ id: 'overtime-choice', schoolId: 'school', date: new Date('2026-05-04T00:00:00.000Z'), hours: 1, weeklyHours: 1, startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', status: 'PENDING' }],
  });

  const segment = proposal[0].proposals[0].segments[0];
  assert.equal(segment.teacherId, 'safe');
  assert.equal(segment.warnings, undefined);
});

test('batch matching adds overtime warnings from final weekly totals to every affected segment', () => {
  const proposal = buildBatchProposal({
    today: new Date('2026-05-04T00:00:00.000Z'), until: new Date('2026-05-05T00:00:00.000Z'),
    schools: [school], teachers: [{ ...teacher('only', '2025/2026'), maxWeeklyHours: 1 }], absences: [], leavePeriods: [],
    requests: ['monday', 'tuesday'].map((id, index) => ({
      id, schoolId: 'school', date: new Date(`2026-05-0${4 + index}T00:00:00.000Z`), hours: 1, weeklyHours: 1,
      startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: id, status: 'PENDING',
    })),
  });

  const segments = proposal[0].proposals.flatMap(item => item.segments);
  assert.equal(segments.length, 2);
  assert.ok(segments.every(segment => segment.reasons.includes('Mehrarbeit')));
  assert.ok(segments.every(segment => segment.warnings?.includes('Mehrarbeit: Wochenstundenlimit wird überschritten.')));
});

test('batch matching handles a 100-request, 100-teacher, 20-day preview within a bounded runtime', () => {
  const weekdays: Date[] = [];
  const cursor = new Date('2026-09-07T00:00:00.000Z');
  while (weekdays.length < 20) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) weekdays.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const requests = Array.from({ length: 100 }, (_, index) => ({
    id: `benchmark-request-${index}`, schoolId: 'school', date: weekdays[index % weekdays.length],
    hours: 1, weeklyHours: 1, startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: `T${index}`, status: 'PENDING',
  }));
  const teachers = Array.from({ length: 100 }, (_, index) => teacher(`benchmark-teacher-${index}`, '2026/2027'));
  const started = Date.now();
  const proposal = buildBatchProposal({
    today: weekdays[0], until: weekdays.at(-1)!, schools: [school], teachers, absences: [], leavePeriods: [], requests,
  });

  assert.equal(proposal[0].coverage.filledRequests, 100);
  assert.ok(Date.now() - started < 10_000);
});
