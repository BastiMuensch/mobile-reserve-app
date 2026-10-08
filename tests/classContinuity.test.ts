import assert from 'node:assert/strict';
import test from 'node:test';
import { getClassContinuity, classContinuityLabel, type ContinuityAssignment } from '../src/lib/classContinuity';
import { rankCandidates, type TeacherAssignmentForMatching } from '../src/lib/matching';
import { buildBatchProposal, type BatchRequest } from '../src/lib/batchMatching';

const school = { id: 'school', name: 'Testschule', latitude: 48.1, longitude: 11.5 };
const request: BatchRequest = {
  id: 'current-request', schoolId: school.id, locationId: null, className: '3a',
  date: new Date('2026-10-12T00:00:00Z'), endDate: new Date('2026-10-16T00:00:00Z'),
  hours: 2, weeklyHours: 10, startHour: 1, qualifications: 'Grundschule',
  schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Frau Test', status: 'PENDING',
};

function assignment(date: string, overrides: Partial<ContinuityAssignment> = {}): TeacherAssignmentForMatching {
  return {
    date: new Date(`${date}T00:00:00Z`), hours: 2, status: 'ACCEPTED', requestId: 'previous-request',
    request: { schoolId: school.id, locationId: null, className: '3a', status: 'FILLED' },
    ...overrides,
  } as TeacherAssignmentForMatching;
}

function teacher(id: string, assignments: TeacherAssignmentForMatching[] = []) {
  return {
    id, name: id, status: 'ACTIVE', stammschuleId: 'other-school', onlyStammschule: false,
    maxWeeklyHours: 28, isPartTime: false, qualifications: 'Grundschule', preferredType: 'BOTH',
    homeLat: 48.1, homeLng: 11.5, schoolYear: '2026/2027', assignments,
    qualificationType: null, canTeachSports: null, email: null, phone: null, userId: null,
    schedule: null, gender: null, address: '', postalCode: '',
  };
}

function rank(teachers: ReturnType<typeof teacher>[], demand = request, openDays = ['2026-10-12', '2026-10-13']) {
  return rankCandidates(
    demand as Parameters<typeof rankCandidates>[0],
    school as Parameters<typeof rankCandidates>[1],
    teachers, [], [], openDays,
  );
}

test('class continuity counts only the complete preceding Monday–Sunday calendar week', () => {
  const result = getClassContinuity(request, [
    assignment('2026-10-04', { hours: 7 }),
    assignment('2026-10-05'),
    assignment('2026-10-09'),
    assignment('2026-10-11', { hours: 3 }),
    assignment('2026-10-12', { hours: 7 }),
  ], '2026-10-14');

  assert.equal(result.weekStart, '2026-10-05');
  assert.equal(result.weekEnd, '2026-10-11');
  assert.equal(result.days, 3);
  assert.equal(result.hours, 7);
  assert.equal(result.basis, 'class');
});

test('class continuity uses Berlin calendar dates across the autumn time change', () => {
  const result = getClassContinuity(request, [
    // Monday 19 October at 00:30 and Sunday 25 October at 23:30 in Berlin.
    assignment('2026-10-19', { date: new Date('2026-10-18T22:30:00Z') }),
    assignment('2026-10-25', { date: new Date('2026-10-25T22:30:00Z') }),
    // Monday 26 October at 00:30 belongs to the following week.
    assignment('2026-10-26', { date: new Date('2026-10-25T23:30:00Z'), hours: 9 }),
  ], '2026-10-28');

  assert.equal(result.weekStart, '2026-10-19');
  assert.equal(result.weekEnd, '2026-10-25');
  assert.equal(result.days, 2);
  assert.equal(result.hours, 4);
});

test('frequency counts distinct class days while summing all recorded lesson hours', () => {
  const oneDay = getClassContinuity(request, [assignment('2026-10-05')], '2026-10-12');
  const sameDay = getClassContinuity(request, [
    assignment('2026-10-05'), assignment('2026-10-05', { hours: 1, requestId: 'second-previous-request' }),
  ], '2026-10-12');
  const twoDays = getClassContinuity(request, [assignment('2026-10-05'), assignment('2026-10-06')], '2026-10-12');

  assert.equal(sameDay.days, 1);
  assert.equal(sameDay.hours, 3);
  assert.equal(sameDay.bonus, oneDay.bonus);
  assert.ok(twoDays.bonus > oneDay.bonus);
  assert.match(classContinuityLabel(sameDay), /1 Tag · 3 UStd\..*derselben Klasse/);
});

test('class labels are normalized but never merged across schools or sites', () => {
  const result = getClassContinuity(request, [
    assignment('2026-10-05', { request: { schoolId: school.id, className: ' ３Ａ ' } }),
    assignment('2026-10-06', { request: { schoolId: 'other-school', className: '3a' } }),
    assignment('2026-10-07', { request: { schoolId: school.id, locationId: 'annex', className: '3a' } }),
    assignment('2026-10-08', { request: { schoolId: school.id, className: '3b' } }),
    assignment('2026-10-09', { request: undefined }),
  ], '2026-10-12');

  assert.equal(result.days, 1);
  assert.equal(result.hours, 2);
  const annex = getClassContinuity({ ...request, locationId: 'annex' }, [
    assignment('2026-10-05'),
    assignment('2026-10-06', { request: { schoolId: school.id, locationId: 'annex', className: '3a' } }),
  ], '2026-10-12');
  assert.equal(annex.days, 1);
});

test('a previous week crossing September does not reuse class history from the preceding school year', () => {
  const result = getClassContinuity(request, [
    assignment('2026-08-31', { hours: 7 }),
    assignment('2026-09-01'),
    assignment('2026-09-04'),
  ], '2026-09-07');
  assert.equal(result.weekStart, '2026-08-31');
  assert.equal(result.days, 2);
  assert.equal(result.hours, 4);
});

test('rejected, cancelled and zero-hour assignments cannot establish class familiarity', () => {
  const result = getClassContinuity(request, [
    assignment('2026-10-05', { status: 'REJECTED' }),
    assignment('2026-10-06', { status: 'CANCELLED' }),
    assignment('2026-10-07', { request: { schoolId: school.id, className: '3a', status: 'CANCELLED' } }),
    assignment('2026-10-08', { hours: 0 }),
    assignment('2026-10-09', { hours: -2 }),
    assignment('2026-10-10', { status: 'PENDING', hours: 3 }),
    assignment('2026-10-11'),
  ], '2026-10-12');
  assert.equal(result.days, 2);
  assert.equal(result.hours, 5);
});

test('without a class label only this exact request supplies continuity evidence', () => {
  for (const className of [undefined, null, '', '  ']) {
    const result = getClassContinuity({ ...request, className }, [
      assignment('2026-10-05', { requestId: request.id, request: undefined }),
      assignment('2026-10-06', { requestId: 'different-request', request: { schoolId: school.id, className: null } }),
      assignment('2026-10-07'),
    ], '2026-10-12');
    assert.equal(result.days, 1);
    assert.equal(result.basis, 'request');
    assert.match(classContinuityLabel(result), /in dieser Anforderung/);
  }
});

test('single-day needs show the history but only long-term needs receive its ranking bonus', () => {
  const history = [assignment('2026-10-05')];
  const singleDay = getClassContinuity({ ...request, endDate: null }, history, '2026-10-12');
  const fixedPeriod = getClassContinuity(request, history, '2026-10-12');
  const openPeriod = getClassContinuity({ ...request, endDate: null, isOpenEnded: true }, history, '2026-10-12');
  assert.equal(singleDay.days, 1);
  assert.equal(singleDay.bonus, 0);
  assert.ok(fixedPeriod.bonus > 0);
  assert.ok(openPeriod.bonus > 0);
});

test('equally qualified candidates with frequent class history rank above a nearer newcomer', () => {
  const newcomers = teacher('nearby-newcomer');
  const occasional = { ...teacher('one-day', [assignment('2026-10-05')]), homeLat: 48.2 };
  const familiar = { ...teacher('three-days', [assignment('2026-10-05'), assignment('2026-10-06'), assignment('2026-10-07')]), homeLat: 48.2 };
  const result = rank([newcomers, occasional, familiar]);
  assert.deepEqual(result.map(candidate => candidate.id), ['three-days', 'one-day', 'nearby-newcomer']);
  assert.equal(result[0].classContinuity?.days, 3);
  assert.equal(result[0].classContinuity?.hours, 6);
});

test('class history does not override qualification or home-school priority', () => {
  const history = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(date => assignment(date));
  const unqualified = { ...teacher('familiar-unqualified', history), qualifications: 'Sport' };
  const qualified = teacher('qualified-newcomer');
  assert.equal(rank([unqualified, qualified])[0].id, qualified.id);
  const familiar = teacher('familiar', history);
  const home = { ...teacher('home-newcomer'), stammschuleId: school.id };
  assert.equal(rank([familiar, home])[0].id, home.id);
});

test('ongoing individual matching uses the first still-open day rather than the old request start', () => {
  const ongoing = { ...request, date: new Date('2026-09-21T00:00:00Z'), endDate: null, isOpenEnded: true };
  const result = rank([
    teacher('recent-history', [assignment('2026-10-05'), assignment('2026-10-06')]),
    teacher('old-history', [assignment('2026-09-14'), assignment('2026-09-15'), assignment('2026-09-16')]),
  ], ongoing, ['2026-10-14', '2026-10-12', '2026-10-13']);
  assert.equal(result[0].id, 'recent-history');
  assert.equal(result[0].classContinuity?.weekStart, '2026-10-05');
  assert.equal(result[1].classContinuity?.days, 0);
});

test('batch staffing of an ongoing need prefers recent class history and explains the counts', () => {
  const result = buildBatchProposal({
    today: new Date('2026-10-12T00:00:00Z'), until: '2026-10-14',
    schools: [school], absences: [], leavePeriods: [],
    requests: [{ ...request, date: new Date('2026-09-21T00:00:00Z'), endDate: null, isOpenEnded: true }],
    teachers: [
      teacher('newcomer'),
      { ...teacher('occasionally-familiar', [assignment('2026-10-05')]), homeLat: 48.2 },
      { ...teacher('frequently-familiar', [assignment('2026-10-05'), assignment('2026-10-06'), assignment('2026-10-07')]), homeLat: 48.2 },
    ],
  });
  const segment = result[0].proposals[0].segments[0];
  assert.equal(segment.teacherId, 'frequently-familiar');
  assert.deepEqual(segment.entries.map(entry => entry.date), ['2026-10-12', '2026-10-13', '2026-10-14']);
  assert.ok(segment.reasons.some(reason => /Vorwoche: 3 Tage · 6 UStd\..*derselben Klasse/.test(reason)));
  assert.equal(segment.alternatives[0].teacherId, 'occasionally-familiar');
  assert.ok(segment.alternatives[0].reasons.some(reason => /Vorwoche: 1 Tag · 2 UStd\./.test(reason)));
  assert.ok(!segment.alternatives.find(candidate => candidate.teacherId === 'newcomer')!.reasons.some(reason => reason.startsWith('Vorwoche:')));
});

test('individual and batch matching measure the week before a candidate’s actual later block', () => {
  const laterRequest = { ...request, endDate: new Date('2026-10-20T00:00:00Z'), weeklyHours: 14 };
  const firstWeek = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
  const familiar = teacher('available-second-week', firstWeek.map(date => assignment(date)));
  const ranked = rank([familiar], laterRequest, [...firstWeek, '2026-10-19', '2026-10-20']);
  assert.deepEqual(ranked[0].eligibleDateKeys, ['2026-10-19', '2026-10-20']);
  assert.equal(ranked[0].classContinuity?.weekStart, '2026-10-12');
  assert.equal(ranked[0].classContinuity?.days, 5);

  const proposal = buildBatchProposal({
    today: new Date('2026-10-12T00:00:00Z'), until: '2026-10-20', schools: [school],
    absences: [], leavePeriods: [], requests: [laterRequest], teachers: [familiar],
  });
  const segment = proposal[0].proposals[0].segments[0];
  assert.deepEqual(segment.entries.map(entry => entry.date), ['2026-10-19', '2026-10-20']);
  assert.ok(segment.reasons.some(reason => /Vorwoche: 5 Tage · 10 UStd\./.test(reason)));
});
