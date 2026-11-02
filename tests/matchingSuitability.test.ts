import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, School, Teacher, Prisma } from '@prisma/client';
import { teachingSuitability, requestedTeachingSchoolType, requireTeachingSuitability, SuitabilityConfirmationRequired, PROVISIONAL_QUALIFICATION_REASON, subjectLabel } from '@/lib/matchingSuitability';
import { rankCandidates } from '@/lib/matching';
import { buildBatchProposal, type BatchRequest, type BatchTeacher } from '@/lib/batchMatching';
import { createRequestSchema } from '@/lib/requestValidation';
import { validateAndCreateAssignments } from '@/lib/assignService';
import { requestAttemptFingerprint, type NormalizedRequestAttempt } from '@/lib/requestIdempotency';

const school = { id: 'gs', name: 'Grundschule', latitude: 48, longitude: 11 };
const day = '2026-11-09';
const request: BatchRequest = {
  id: 'request', schoolId: 'gs', date: day, hours: 4, startHour: 1, weeklyHours: 4,
  schoolType: 'GS_MS', requestedSchoolType: 'GRUNDSCHULE', gradeLevel: 2,
  qualifications: 'Grundschule', substitutedTeacher: 'Vertretung', status: 'PENDING',
};
const teacher = (id: string, qualificationType: string): BatchTeacher => ({
  id, name: id, status: 'ACTIVE', stammschuleId: 'other', schoolYear: '2026/2027',
  qualifications: 'Alles', qualificationType, maxWeeklyHours: 28, isPartTime: false,
  preferredType: 'BOTH', homeLat: 48, homeLng: 11, assignments: [],
});
const plan = (requests: BatchRequest[], teachers: BatchTeacher[], until = day) => buildBatchProposal({
  schools: [school, { ...school, id: 'ms', name: 'Mittelschule' }], requests, teachers, today: new Date(`${day}T09:00:00Z`), until,
  absences: [], leavePeriods: [], schoolYear: '2026/2027',
});

test('explicit GS demand at a combined school prioritizes qualified GS despite MS home school, Alles, closeness and continuity', () => {
  const gs = { ...teacher('gs-qualified', 'TEACHER_GS'), homeLat: 49 };
  const ms = { ...teacher('ms-home', 'TEACHER_MS'), stammschuleId: 'gs' };
  assert.equal(requestedTeachingSchoolType(request), 'GRUNDSCHULE');
  assert.equal(teachingSuitability(ms, request).level, 'MISMATCH');
  const candidates = rankCandidates(request as unknown as Request, school as School, [ms, gs] as unknown as (Teacher & { assignments: [] })[], [], [], [day]);
  assert.equal(candidates[0].id, gs.id);
  assert.equal(candidates[1].suitability.level, 'MISMATCH');
  assert.match(candidates[0].matchReasons.join(' '), /GS-Lehrkraft passt/);
  assert.equal(plan([request], [ms, gs])[0].proposals[0].segments[0].teacherId, gs.id);
});

test('GS and MS teachers are not crossed between primary grade 1 and secondary grade 7 needs', () => {
  const msRequest = { ...request, id: 'ms-request', schoolId: 'ms', requestedSchoolType: 'MITTELSCHULE', gradeLevel: 7, qualifications: 'Mittelschule' };
  const proposal = plan([{ ...request, gradeLevel: 1 }, msRequest], [
    { ...teacher('gs-teacher', 'TEACHER_GS'), stammschuleId: 'ms' },
    { ...teacher('ms-teacher', 'TEACHER_MS'), stammschuleId: 'gs' },
  ]);
  const byRequest = Object.fromEntries(proposal.flatMap(row => row.proposals.map(item => [item.requestId, item.segments[0].teacherId])));
  assert.deepEqual(byRequest, { request: 'gs-teacher', 'ms-request': 'ms-teacher' });
});

test('reserves without a qualification category are provisionally suitable for every deployment', () => {
  const legacyTeacher = { ...teacher('unknown', ''), qualificationType: null };
  const result = teachingSuitability(legacyTeacher, request);
  assert.equal(result.level, 'MATCH');
  assert.ok(result.reasons.includes(PROVISIONAL_QUALIFICATION_REASON));
  assert.equal(plan([request], [legacyTeacher])[0].proposals.length, 1, 'batch planning proposes provisional reserves');
  assert.equal(requireTeachingSuitability(legacyTeacher, request).level, 'MATCH', 'no fallback confirmation required');
  // Old combined-school demand without a school type and an unlisted subject stay provisional matches.
  assert.equal(teachingSuitability(legacyTeacher, { schoolType: 'GS_MS', qualifications: '' }).level, 'MATCH');
  assert.equal(teachingSuitability(legacyTeacher, { ...request, requiredSubject: 'Englisch' }).level, 'MATCH');
  // The generic historic "Lehrkraft" value counts as missing; Student/in still needs review.
  assert.equal(teachingSuitability({ ...legacyTeacher, qualificationType: 'TEACHER' }, request).level, 'MATCH');
  assert.equal(teachingSuitability({ ...legacyTeacher, qualificationType: 'STUDENT' }, request).level, 'REVIEW');
  // An explicit "no sport" answer is still respected.
  assert.equal(teachingSuitability({ ...legacyTeacher, canTeachSports: false }, { ...request, requiredSubject: 'Sport' }).level, 'MISMATCH');
});

test('suitability reasons show subject names capitalized', () => {
  const gs = { ...teacher('gs', 'TEACHER_GS'), qualifications: 'deutsch, Mathe' };
  const reasons = teachingSuitability(gs, { ...request, requiredSubject: 'mathe', qualifications: 'Grundschule, Deutsch' }).reasons;
  assert.ok(reasons.includes('Fach Mathematik passt'), reasons.join(' | '));
  assert.ok(reasons.includes('Fach Deutsch passt'), reasons.join(' | '));
  assert.equal(subjectLabel('heimat- und sachunterricht'), 'Heimat- und Sachunterricht');
});

test('specialists match a recorded subject but require review for a general class; explicit no-sport cannot be bypassed', () => {
  const specialist = { ...teacher('specialist', 'SPECIALIST'), qualifications: 'Musik, Mathe', canTeachSports: false };
  assert.equal(teachingSuitability(specialist, request).level, 'REVIEW');
  assert.equal(teachingSuitability(specialist, { ...request, requiredSubject: 'Mathematik' }).level, 'MATCH');
  assert.equal(teachingSuitability(specialist, { ...request, requiredSubject: 'Sport' }).level, 'MISMATCH');
  assert.equal(teachingSuitability({ ...teacher('gs', 'TEACHER_GS'), canTeachSports: true }, { ...request, requiredSubject: 'Sport' }).level, 'MATCH');
  assert.equal(teachingSuitability({ ...teacher('support', 'SUPPORT'), qualifications: 'Mathematik' }, { ...request, requiredSubject: 'Mathematik' }).level, 'REVIEW');
});

test('home-school priority cannot be overwhelmed by a longer available block', () => {
  const home = { ...teacher('home', 'TEACHER_GS'), stammschuleId: 'gs', isPartTime: true, schedule: '{"1":[1,2,3,4]}' };
  const fullWeek = teacher('full-week', 'TEACHER_GS');
  const result = plan([{ ...request, endDate: '2026-11-13' }], [home, fullWeek], '2026-11-13')[0].proposals[0];
  assert.equal(result.segments[0].teacherId, home.id);
  assert.equal(result.segments[0].entries[0].date, day);
  assert.equal(result.coverage.assignedHours, 20);
  assert.equal(result.segments[1].entries.length, 4);
});

test('grade validation rejects inconsistent GS/MS values and fingerprints include all structured requirements', () => {
  const body = { schoolId: '067c8b70-652d-4d85-847c-67e6488b92db', date: day, startHour: 1, hours: 4, substitutedTeacher: 'Name', requestedSchoolType: 'GRUNDSCHULE', gradeLevel: 2, requiredSubject: ' Mathematik ' };
  const schema = createRequestSchema(day);
  assert.equal(schema.parse(body).requiredSubject, 'Mathematik');
  assert.equal(schema.safeParse({ ...body, gradeLevel: 7 }).success, false);
  assert.equal(schema.safeParse({ ...body, requestedSchoolType: 'MITTELSCHULE', gradeLevel: 2 }).success, false);
  assert.equal(schema.safeParse({ ...body, gradeLevel: 11 }).success, false);
  const attempt = { ...body, date: new Date(day), endDate: null, priority: 'OTHER', weeklyHours: 4, schoolType: 'GS_MS', schedule: null, qualifications: '', comments: '', isOpenEnded: false } as NormalizedRequestAttempt;
  for (const change of [{ gradeLevel: 3 }, { requestedSchoolType: 'MITTELSCHULE' }, { requiredSubject: 'Sport' }]) {
    assert.notEqual(requestAttemptFingerprint(attempt), requestAttemptFingerprint({ ...attempt, ...change }));
  }
});

test('server assignment guard rejects a client bypass before writing any assignment', async () => {
  let writes = 0;
  const tx = {
    request: { findUnique: async () => ({ ...request, date: new Date(day), school: { schulamtId: 'office' }, assignments: [] }) },
    teacher: { findUnique: async () => ({ ...teacher('wrong', 'TEACHER_MS'), stammschule: { schulamtId: 'office' } }) },
    assignment: { createMany: async () => { writes++; } },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(validateAndCreateAssignments(tx, { requestId: request.id, teacherId: 'wrong', schulamtId: 'office', entries: [{ date: day, hours: 4 }] }), SuitabilityConfirmationRequired);
  assert.equal(writes, 0);
});

test('approved actual hours affect weekly capacity but do not release the already assigned day', () => {
  const reserve = { ...teacher('reserve', 'TEACHER_GS'), maxWeeklyHours: 8, assignments: [
    { date: new Date(day), hours: 4, actualHours: 6, status: 'ACCEPTED' },
  ] };
  const nextRequest = { ...request, date: '2026-11-10' };
  const ranked = rankCandidates(nextRequest as unknown as Request, school as School, [reserve] as unknown as (Teacher & { assignments: [] })[], [], [], ['2026-11-10']);
  assert.equal(ranked[0].assignedHours, 6);
  assert.equal(ranked[0].isOvertime, true);
  assert.equal(rankCandidates(request as unknown as Request, school as School, [reserve] as unknown as (Teacher & { assignments: [] })[], [], [], [day]).length, 0);
  const batch = plan([nextRequest], [reserve], '2026-11-10')[0].proposals[0].segments[0];
  assert.match(batch.warnings?.join(' ') ?? '', /Mehrarbeit/);
});

test('two-way planning swap improves total fit while preserving retained choices, coverage and lesson capacity', () => {
  const schools = [{ ...school, id: 'a', name: 'A', latitude: 48 }, { ...school, id: 'b', name: 'B', latitude: 48.01 }];
  const requests = [{ ...request, id: 'a-request', schoolId: 'a' }, { ...request, id: 'b-request', schoolId: 'b' }];
  const teachers = [{ ...teacher('near-a', 'TEACHER_GS'), homeLat: 48.003 }, { ...teacher('south-a', 'TEACHER_GS'), homeLat: 47.996 }];
  const input = { schools, requests, teachers, today: new Date(`${day}T09:00:00Z`), until: day, absences: [], leavePeriods: [] };
  const result = buildBatchProposal(input);
  assert.equal(result[0].proposals[0].segments[0].teacherId, 'south-a');
  assert.equal(result[1].proposals[0].segments[0].teacherId, 'near-a');
  assert.match(result[0].proposals[0].segments[0].reasons.join(' '), /Tausch/);
  assert.deepEqual(result.map(row => row.coverage.assignedHours), [4, 4]);

  const retained = buildBatchProposal({ ...input, retainedItems: [{ requestId: 'a-request', segments: [{ teacherId: 'near-a', entries: [{ date: day, hours: 4 }] }] }] });
  assert.equal(retained[0].proposals[0].segments[0].teacherId, 'near-a');
  assert.equal(retained[1].proposals[0].segments[0].teacherId, 'south-a');

  const capacityLimited = buildBatchProposal({ ...input,
    requests: [requests[0], { ...requests[1], hours: 2, weeklyHours: 2 }],
    teachers: [teachers[0], { ...teachers[1], isPartTime: true, schedule: '{"1":[1,2]}' }],
  });
  assert.equal(capacityLimited[0].proposals[0].segments[0].teacherId, 'near-a');
  assert.equal(capacityLimited[1].proposals[0].segments[0].teacherId, 'south-a');
  assert.deepEqual(capacityLimited.map(row => row.coverage.assignedHours), [4, 2]);

  const home = buildBatchProposal({ ...input, teachers: [{ ...teachers[0], stammschuleId: 'a' }, teachers[1]] });
  assert.equal(home[0].proposals[0].segments[0].teacherId, 'near-a', 'distance improvement never sacrifices home-school priority');
});
