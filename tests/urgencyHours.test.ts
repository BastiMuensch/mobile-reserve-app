import test from 'node:test';
import assert from 'node:assert/strict';
import { averageDailyRequestHours, requestUrgencyScore, urgencyReasons } from '../src/lib/urgency';
import { buildBatchProposal, type BatchRequest, type BatchTeacher } from '../src/lib/batchMatching';

const today = new Date('2026-10-12T00:00:00');
const base: BatchRequest = {
  id: 'request', schoolId: 'school', date: '2026-10-12', hours: 6, weeklyHours: 6,
  startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Beispiel',
  status: 'PENDING', priority: 'UNPLANNED_ABSENCE',
};

test('urgency includes daily hours while retaining small school and outbreak priorities', () => {
  const score = (request: typeof base, school = {}, isOutbreak = false) => requestUrgencyScore(request, school, { today, isOutbreak });
  assert.ok(score(base) > score({ ...base, hours: 2 }));
  assert.ok(score({ ...base, priority: 'OTHER' }) > score({ ...base, hours: 2 }));
  assert.ok(score(base, { isSmall: true }) > score(base));
  assert.ok(score(base, {}, true) > score(base));
  assert.match(urgencyReasons({ ...base, hours: 2 }, {}, { today }).join(', '), /2 Std.\/Einsatztag · geringer Stundenbedarf/);
  for (const status of ['FILLED', 'CANCELLED', 'UNFILLED']) {
    assert.equal(score({ ...base, status }), 0);
    assert.deepEqual(urgencyReasons({ ...base, status }, {}, { today }), []);
  }
});

test('daily urgency uses scheduled working days rather than weekly totals or duration', () => {
  const twoHours = { ...base, hours: 10, endDate: '2026-10-23', schedule: JSON.stringify({ 1: [1, 2], 2: [1, 2], 3: [1, 2], 4: [1, 2], 5: [1, 2] }) };
  assert.equal(averageDailyRequestHours(twoHours, today), 2);
  assert.equal(requestUrgencyScore(twoHours, {}, { today }), requestUrgencyScore({ ...base, hours: 2 }, {}, { today }));
  assert.equal(averageDailyRequestHours({ ...base, endDate: '2026-10-16', schedule: JSON.stringify({ 1: [1, 2], 3: [1, 2, 3, 4, 5, 6] }) }, today), 4);
  assert.equal(averageDailyRequestHours({ ...base, schedule: JSON.stringify({ 1: [1, 2], 5: [1, 2, 3, 4, 5, 6] }) }, today), 2);
});

test('ongoing requests use their current planning horizon for the daily workload', () => {
  const ongoing = { ...base, date: '2026-09-01', isOpenEnded: true, schedule: JSON.stringify({ 1: [1, 2], 3: [1, 2, 3, 4] }) };
  assert.equal(averageDailyRequestHours(ongoing, today), 3);
  assert.equal(urgencyReasons(ongoing, {}, { today }).includes('Überfällig'), false);
  assert.equal(averageDailyRequestHours({ ...base, hours: undefined, schedule: null }, today), 0);
  assert.ok(Number.isFinite(requestUrgencyScore({ ...base, hours: undefined }, {}, { today })));
});

function teacher(id: string): BatchTeacher {
  return { id, name: id, status: 'ACTIVE', stammschuleId: 'school', maxWeeklyHours: 28,
    isPartTime: false, qualifications: 'Alles', preferredType: 'BOTH', homeLat: 48, homeLng: 11, schoolYear: '2026/2027' };
}

test('ideal staffing gives a scarce reserve to the six-hour request before a two-hour gap', () => {
  const result = buildBatchProposal({
    today, until: today, schools: [{ id: 'school', name: 'Große Schule', latitude: 48, longitude: 11 }],
    teachers: [teacher('reserve')], absences: [], leavePeriods: [],
    requests: [{ ...base, id: 'two-hours', hours: 2 }, { ...base, id: 'six-hours', priority: 'OTHER' }],
  });
  assert.deepEqual(result.flatMap(school => school.proposals.map(proposal => proposal.requestId)), ['six-hours']);
});

test('smaller demand at another school does not jump ahead of a second substantial demand', () => {
  const result = buildBatchProposal({
    today, until: today,
    schools: [{ id: 'school', name: 'Schule A', latitude: 48, longitude: 11 }, { id: 'other', name: 'Schule B', latitude: 48, longitude: 11 }],
    teachers: [teacher('reserve-one'), teacher('reserve-two')], absences: [], leavePeriods: [],
    requests: [{ ...base, id: 'six-hours-one' }, { ...base, id: 'six-hours-two' }, { ...base, id: 'two-hours', schoolId: 'other', hours: 2 }],
  });
  assert.deepEqual(result.flatMap(school => school.proposals.map(proposal => proposal.requestId)).sort(), ['six-hours-one', 'six-hours-two']);
});
