import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates } from '../src/lib/matching';
import { buildBatchProposal, type BatchInput } from '../src/lib/batchMatching';

const school = { id: 'home', name: 'Stammschule', latitude: 48.1, longitude: 11.5 };
const otherSchool = { ...school, id: 'other', name: 'Andere Schule' };
const teacher = {
  qualificationType: null, canTeachSports: null, id: 'restricted', name: 'Reserve', status: 'ACTIVE', stammschuleId: 'home', onlyStammschule: true,
  maxWeeklyHours: 28, isPartTime: false, qualifications: 'Alles', preferredType: 'BOTH',
  homeLat: 48.1, homeLng: 11.5, schoolYear: '2026/2027', assignments: [],
  email: null, phone: null, userId: null, schedule: null, gender: null, address: '', postalCode: '',
};
const request = {
  id: 'request', schoolId: 'other', date: new Date('2026-09-07T00:00:00Z'),
  hours: 2, weeklyHours: 2, startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE',
  substitutedTeacher: 'Test', status: 'PENDING',
};
const input: BatchInput = {
  today: new Date('2026-09-07T00:00:00Z'), until: '2026-09-07', schoolYear: '2026/2027',
  schools: [school, otherSchool], teachers: [teacher], requests: [request], absences: [], leavePeriods: [],
};

function rank(schoolId: string, restricted = true) {
  return rankCandidates(
    { ...request, schoolId } as Parameters<typeof rankCandidates>[0],
    { ...school, id: schoolId } as Parameters<typeof rankCandidates>[1],
    [{ ...teacher, onlyStammschule: restricted }],
  );
}

test('individual matching excludes restricted reserves from other schools and allows their home school', () => {
  assert.equal(rank('other').length, 0);
  assert.equal(rank('home').length, 1);
  assert.equal(rank('other', false).length, 1);
});

test('ideal staffing leaves another school unfilled instead of ignoring the restriction', () => {
  const result = buildBatchProposal(input).find(s => s.schoolId === 'other')!;
  assert.equal(result.proposals.length, 0);
  assert.equal(result.unfillable.length, 1);
  const home = buildBatchProposal({ ...input, requests: [{ ...request, schoolId: 'home' }] }).find(s => s.schoolId === 'home')!;
  assert.equal(home.proposals[0].segments[0].teacherId, teacher.id);
});

test('restricted reserves are also excluded from alternatives, while unrestricted reserves remain eligible', () => {
  const flexible = { ...teacher, id: 'flexible', onlyStammschule: false };
  const result = buildBatchProposal({ ...input, teachers: [teacher, flexible] }).find(s => s.schoolId === 'other')!;
  const segment = result.proposals[0].segments[0];
  assert.equal(segment.teacherId, flexible.id);
  assert.deepEqual(segment.alternatives, []);
  const unrestricted = buildBatchProposal({ ...input, teachers: [{ ...teacher, onlyStammschule: false }, flexible] }).find(s => s.schoolId === 'other')!;
  assert.equal(unrestricted.proposals[0].segments[0].alternatives.length, 1);
});

test('informational qualification status and sports never affect ranking or ideal staffing', () => {
  const baseline = { ...teacher, onlyStammschule: false };
  const rankRequest = request as Parameters<typeof rankCandidates>[0];
  const rankSchool = otherSchool as Parameters<typeof rankCandidates>[1];
  const scores = (candidates: Parameters<typeof rankCandidates>[2]) => rankCandidates(rankRequest, rankSchool, candidates)
    .map(candidate => ({ id: candidate.id, score: candidate.matchScore }));
  const expectedScores = scores([baseline]);
  const expectedProposal = buildBatchProposal({ ...input, teachers: [baseline] });
  for (const qualificationType of ['TEACHER_GS', 'TEACHER_MS', 'SPECIALIST', 'SUPPORT', 'STUDENT', 'TEACHER', null]) {
    for (const canTeachSports of [true, false, null]) {
      const variant = { ...baseline, qualificationType, canTeachSports };
      assert.deepEqual(scores([variant]), expectedScores);
      assert.deepEqual(buildBatchProposal({ ...input, teachers: [variant] }), expectedProposal);
    }
  }
});
