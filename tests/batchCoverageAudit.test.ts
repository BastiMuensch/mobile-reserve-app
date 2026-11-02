import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchProposal, type BatchRequest, type BatchTeacher } from '../src/lib/batchMatching';

const school = { id: 'school', name: 'Grundschule', latitude: 48, longitude: 11 };
const request: BatchRequest = { id: 'need', schoolId: school.id, date: '2026-11-09', hours: 6, startHour: 1, weeklyHours: 6, qualifications: 'Grundschule', requestedSchoolType: 'GRUNDSCHULE', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Test', status: 'PENDING' };
const teacher = (id: string): BatchTeacher => ({ id, name: id, status: 'ACTIVE', stammschuleId: 'other', qualificationType: 'TEACHER_GS', qualifications: 'Grundschule', schoolYear: '2026/2027', preferredType: 'BOTH', maxWeeklyHours: 28, homeLat: 48, homeLng: 11, isPartTime: false });
const nearby = { ...teacher('nearby-one-hour'), isPartTime: true, schedule: '{"1":[1]}' };
const farther = { ...teacher('farther-six-hours'), homeLat: 48.1 };
function plan(teachers: BatchTeacher[]) {
  return buildBatchProposal({ schools: [school], requests: [request], teachers, absences: [], leavePeriods: [], today: new Date('2026-11-09T08:00:00Z'), until: '2026-11-09' })[0].proposals[0];
}

test('equally suitable reserves maximize available lesson coverage before distance', () => {
  const result = plan([nearby, farther]);
  assert.equal(result.segments[0].teacherId, farther.id);
  assert.equal(result.coverage.assignedHours, 6);
  assert.equal(result.coverage.requiredHours, 6);
});

test('greater coverage does not silently replace an eligible home-school reserve or add overtime', () => {
  const home = plan([{ ...nearby, stammschuleId: school.id }, farther]);
  assert.equal(home.segments[0].teacherId, nearby.id);
  assert.equal(home.coverage.assignedHours, 1);
  const overtime = plan([nearby, { ...farther, maxWeeklyHours: 5 }]);
  assert.equal(overtime.segments[0].teacherId, nearby.id);
  assert.equal(overtime.segments[0].warnings, undefined);
});
