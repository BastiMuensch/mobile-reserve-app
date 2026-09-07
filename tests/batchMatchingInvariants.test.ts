import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchProposal, type BatchTeacher, type BatchRequest } from '../src/lib/batchMatching';
import { canTeacherCoverRequestHours } from '../src/lib/matching';

test('batch allocation and repair preserve coverage, availability and final alternatives across mixed fixtures', () => {
  for (let seed = 0; seed < 40; seed += 1) {
    const schools = Array.from({ length: 3 }, (_, index) => ({
      id: `s${index}`, name: `Schule ${index}`, latitude: 48.1, longitude: 11.5,
    }));
    const teachers: BatchTeacher[] = Array.from({ length: 5 }, (_, index) => ({
      id: `t${index}`, name: `Lehrkraft ${index}`, status: index === seed % 7 ? 'INACTIVE' : 'ACTIVE',
      stammschuleId: `s${(index + seed) % 3}`, maxWeeklyHours: 20, isPartTime: true,
      schedule: JSON.stringify({ '1': (index + seed) % 2 ? [1, 2] : [1], '2': [2] }),
      qualifications: 'Alles', preferredType: 'BOTH', homeLat: 48.1, homeLng: 11.5, schoolYear: '2026/2027',
    }));
    const requests: BatchRequest[] = Array.from({ length: 8 }, (_, index) => ({
      id: `r${index}`, schoolId: `s${index % 3}`, date: index % 2 ? '2026-09-08' : '2026-09-07',
      hours: 1, weeklyHours: 1, startHour: (index + seed) % 2 + 1,
      qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Test', status: 'PENDING',
      priority: index % 3 ? 'UNPLANNED_ABSENCE' : null,
    }));
    const absence = { teacherId: `t${seed % 5}`, date: new Date('2026-09-07T00:00:00Z') };
    const input = { today: new Date('2026-09-07T12:00:00Z'), until: '2026-09-08', schoolYear: '2026/2027', schools, teachers, requests, absences: [absence], leavePeriods: [] };
    const plan = buildBatchProposal(input);
    assert.deepEqual(buildBatchProposal(input), plan, `deterministic seed ${seed}`);
    const booked = new Set<string>();
    for (const school of plan) {
      assert.equal(school.coverage.assignedHours, school.proposals.reduce((sum, p) => sum + p.coverage.assignedHours, 0));
      assert.equal(school.coverage.filledRequests, school.proposals.filter(p => p.coverage.assignedHours === p.coverage.requiredHours).length);
      for (const proposal of school.proposals) {
        const request = requests.find(item => item.id === proposal.requestId)!;
        assert.equal(proposal.coverage.assignedHours, proposal.segments.reduce((sum, segment) => sum + segment.entries.reduce((subtotal, day) => subtotal + day.hours, 0), 0));
        assert.ok(proposal.coverage.assignedHours <= proposal.coverage.requiredHours);
        for (const segment of proposal.segments) {
          const teacher = teachers.find(item => item.id === segment.teacherId)!;
          assert.equal(teacher.status, 'ACTIVE');
          for (const day of segment.entries) {
            const key = `${teacher.id}:${day.date}`;
            assert.equal(booked.has(key), false, `double booking seed ${seed}`);
            booked.add(key);
            assert.notEqual(key, `${absence.teacherId}:2026-09-07`);
            assert.equal(canTeacherCoverRequestHours(teacher, request, day.date, day.hours), true);
          }
        }
      }
    }
    for (const school of plan) for (const proposal of school.proposals) for (const segment of proposal.segments) {
      for (const alternative of segment.alternatives) for (const day of segment.entries) {
        assert.equal(booked.has(`${alternative.teacherId}:${day.date}`), false, `occupied alternative seed ${seed}`);
      }
    }
  }
});
