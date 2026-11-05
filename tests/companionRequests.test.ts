import assert from 'node:assert/strict';
import test from 'node:test';
import { companionRequestsForTeacher, selectedCompanionEntries } from '../src/lib/companionRequests';
import { rankCandidates } from '../src/lib/matching';

type Input = Parameters<typeof companionRequestsForTeacher>[0];
const date = '2026-11-09';
const school = { id: 'school', latitude: 48, longitude: 11 } as Input['school'];
const anchor = { id: 'a', schoolId: 'school', locationId: null, date: new Date(date), endDate: null,
  hours: 3, startHour: 1, weeklyHours: 3, schoolType: 'GRUNDSCHULE', requestedSchoolType: 'GRUNDSCHULE',
  qualifications: '', substitutedTeacher: 'A', status: 'PENDING', assignments: [] } as unknown as Input['anchor'];
const teacher = { id: 'teacher', name: 'Reserve', stammschuleId: 'school', status: 'ACTIVE', isPartTime: false,
  schoolYear: '2026/2027', qualifications: 'Alles', qualificationType: null, preferredType: 'BOTH',
  maxWeeklyHours: 28, homeLat: 48, homeLng: 11, assignments: [] } as unknown as Input['teacher'];
function options(requests: Input['requests'], override: Partial<Input['teacher']> = {}) {
  const reserve = { ...teacher, ...override };
  const candidate = rankCandidates(anchor, school, [reserve], [], [], [date])[0];
  return companionRequestsForTeacher({ anchor, candidate, teacher: reserve, requests, school, absences: [], leaves: [] });
}
const later = { ...anchor, id: 'b', startHour: 4, substitutedTeacher: 'B' };

test('3 + 3 at one site is offered as a separate compatible request', () => {
  const [option] = options([later]);
  assert.equal(option.requestId, 'b');
  assert.deepEqual(option.entries, [{ date, hours: 3, lessonHours: '[4,5,6]' }]);
});

test('different schools, sites, overlapping lessons and missing capacity are excluded', () => {
  assert.deepEqual(options([{ ...later, schoolId: 'other' }, { ...later, locationId: 'annex' },
    { ...later, startHour: 3 }]), []);
  assert.deepEqual(options([later], { isPartTime: true, schedule: JSON.stringify({ 1: [1, 2, 3] }) }), []);
});

test('suggestions are mutually compatible and include total weekly load', () => {
  const result = options([later, { ...later, id: 'c' }], { maxWeeklyHours: 5 });
  assert.equal(result.length, 1);
  assert.equal(result[0].isOvertime, true);
});

test('only selected anchor dates with unchanged hours carry a companion', () => {
  const [option] = options([later]);
  const selected = { date, hours: '3', selected: true, suggestedHours: 3 };
  assert.equal(selectedCompanionEntries(option, [selected]).length, 1);
  assert.deepEqual(selectedCompanionEntries(option, [{ ...selected, selected: false }]), []);
  assert.deepEqual(selectedCompanionEntries(option, [{ ...selected, hours: '4' }]), []);
});
