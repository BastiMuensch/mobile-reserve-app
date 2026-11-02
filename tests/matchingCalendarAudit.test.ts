import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, School, Teacher } from '@prisma/client';
import { getEffectiveRange, getWeekBounds, leaveCoversDay, rankCandidates, requiredLessonHoursForDay, type TeacherAssignmentForMatching } from '../src/lib/matching';
import { getOpenRequestDays } from '../src/lib/requestDays';
import { isSchoolInOutbreak, requestUrgencyScore } from '../src/lib/urgency';
import { buildBatchProposal, type BatchRequest, type BatchTeacher } from '../src/lib/batchMatching';

const school = { id: 'school', name: 'GS', latitude: 48, longitude: 11 };
const request: BatchRequest = {
  id: 'request', schoolId: 'school', date: new Date('2026-10-26T00:00:00Z'), endDate: new Date('2026-10-30T00:00:00Z'),
  hours: 2, startHour: 1, weeklyHours: 10, qualifications: 'Grundschule', requestedSchoolType: 'GRUNDSCHULE', schoolType: 'GRUNDSCHULE',
  substitutedTeacher: 'Test', status: 'PENDING', schedule: JSON.stringify({ 1: [1, 2], 2: [1, 2], 3: [1, 2], 4: [1, 2], 5: [1, 2] }),
};
const teacher: BatchTeacher = {
  id: 'teacher', name: 'GS-Lehrkraft', status: 'ACTIVE', stammschuleId: 'school', schoolYear: '2026/2027',
  qualifications: 'Grundschule', qualificationType: 'TEACHER_GS', preferredType: 'BOTH', homeLat: 48, homeLng: 11,
  isPartTime: true, schedule: JSON.stringify({ 1: [1, 2], 2: [1], 3: [1], 4: [1], 5: [1] }), maxWeeklyHours: 6,
  assignments: [{ date: new Date('2026-10-29T00:00:00Z'), hours: 2, actualHours: 3, status: 'ACCEPTED' }],
};
const now = new Date('2026-10-25T23:30:00Z'); // Monday in Berlin, Sunday in the US.
const absences = [{ teacherId: 'teacher', date: new Date('2026-10-27T00:00:00Z') }];
const leavePeriods = [{ teacherId: 'teacher', startDate: new Date('2026-10-28T00:00:00Z'), endDate: new Date('2026-10-28T23:59:59.999Z') }];

for (const timezone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Tokyo']) {
  test(`school days, partial lessons, booking/leave and actual weekly totals agree under ${timezone}`, () => {
    const previous = process.env.TZ;
    process.env.TZ = timezone;
    try {
      assert.deepEqual(requiredLessonHoursForDay(request, '2026-10-26'), [1, 2]);
      assert.equal(leaveCoversDay(leavePeriods[0], new Date('2026-10-29T00:00:00Z')), false, 'inclusive UTC end boundary must not block the next Berlin school day');
      const legacyLeave = { teacherId: teacher.id, startDate: new Date('2026-10-26T23:00:00Z'), endDate: new Date('2026-10-27T23:00:00Z') };
      assert.equal(leaveCoversDay(legacyLeave, new Date('2026-10-28T00:00:00Z')), true, 'legacy Berlin midnight includes the final date');
      assert.equal(leaveCoversDay(legacyLeave, new Date('2026-10-29T00:00:00Z')), false);
      assert.equal(isSchoolInOutbreak({ outbreakUntil: '2026-10-28T23:59:59.999Z' }, new Map(), { date: '2026-10-29', hours: 2, status: 'PENDING', schoolId: school.id }, { today: new Date('2026-10-29T10:00:00Z') }), false);
      assert.deepEqual(getOpenRequestDays(request, [], now).map(day => day.date), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
      const candidates = rankCandidates(request as Request, school as School, [teacher] as unknown as (Teacher & { assignments: TeacherAssignmentForMatching[] })[], absences, leavePeriods, ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
      assert.equal(candidates.length, 1);
      assert.deepEqual(candidates[0].availableHoursByDate, { '2026-10-26': 2, '2026-10-30': 1 });
      assert.equal(candidates[0].assignedHours, 3);
      assert.equal(candidates[0].isOvertime, false);
      const batch = buildBatchProposal({ schools: [school], requests: [request], teachers: [teacher], today: now, until: '2026-10-30', schoolYear: '2026/2027', absences, leavePeriods });
      const entries = batch.flatMap(item => item.proposals.flatMap(proposal => proposal.segments.flatMap(segment => segment.entries)));
      assert.deepEqual(entries, [{ date: '2026-10-26', hours: 2 }, { date: '2026-10-30', hours: 1 }]);
      assert.equal(batch[0].coverage.assignedHours, 3);
      assert.equal(batch[0].coverage.requiredHours, 10);
      assert.ok(batch[0].proposals[0].segments.every(segment => !segment.warnings?.length));
      const bounds = getWeekBounds(now);
      assert.equal(bounds.weekStart.toISOString(), '2026-10-26T00:00:00.000Z');
      assert.equal(bounds.weekEnd.toISOString(), '2026-11-01T23:59:59.999Z');
      const ongoing = getEffectiveRange({ date: '2026-10-01', hours: 2, isOpenEnded: true }, now);
      assert.equal(ongoing.start.toISOString(), '2026-10-26T00:00:00.000Z');
      assert.equal(ongoing.end.toISOString(), '2026-10-30T00:00:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
}

test('ended historical demand never receives an urgency score', () => {
  assert.equal(requestUrgencyScore({ ...request, status: 'ENDED' }, { isSmall: true }, { today: now, isOutbreak: true }), 0);
});
