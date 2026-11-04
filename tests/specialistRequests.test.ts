import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedTeachingSchoolType, teachingSuitability } from '../src/lib/matchingSuitability';
import { baseMatchScore } from '../src/lib/matching';
import { buildBatchProposal, type BatchTeacher } from '../src/lib/batchMatching';
import { createRequestSchema } from '../src/lib/requestValidation';
import {
  activeSpecialistFields, requestedDeploymentLabel, resolveTeacherSpecialistFields, SpecialistFieldRequiredError, specialistFieldListSchema,
} from '../src/lib/specialistFields';
import { qualificationCompletionPrompt, qualificationTypeLabel } from '../src/lib/teacherQualifications';
import { districtUsage, schoolDistrictListSchema, SchoolDistrictNotAllowedError, validateSchoolDistrict } from '../src/lib/schoolDistrict';

const egNeed = { requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: 'E/G', gradeLevel: 3, qualifications: 'Fachlehrkraft E/G', schoolType: 'GRUNDSCHULE' };
const base = { qualifications: 'Deutsch', canTeachSports: false };

test('Fachlehrkraft need is never turned into a GS/MS need by its grade', () => {
  assert.equal(requestedTeachingSchoolType(egNeed), null);
  assert.equal(requestedTeachingSchoolType({ ...egNeed, requestedSchoolType: 'GRUNDSCHULE' }), 'GRUNDSCHULE');
});

test('matching Fachrichtung is a preferred match; the free-text label is no subject', () => {
  const result = teachingSuitability({ ...base, qualificationType: 'SPECIALIST', specialistFields: ['E/G'] }, egNeed);
  assert.equal(result.level, 'MATCH');
  assert.equal(result.specialist, 'EXACT');
  assert.ok(result.reasons.includes('Fachlehrkraft E/G passt'));
  assert.ok(!result.reasons.some(reason => reason.startsWith('Fach Fachlehrkraft')));
});

test('any Fachlehrkraft fits a need without Fachrichtung', () => {
  const result = teachingSuitability({ ...base, qualificationType: 'SPECIALIST', specialistFields: ['M/T'] }, { ...egNeed, requestedSpecialistField: null });
  assert.equal(result.level, 'MATCH');
  assert.equal(result.specialist, 'EXACT');
});

test('other or unknown Fachrichtung and GS/MS teachers are confirmable fallbacks', () => {
  const other = teachingSuitability({ ...base, qualificationType: 'SPECIALIST', specialistFields: ['M/T'] }, egNeed);
  assert.equal(other.level, 'REVIEW');
  assert.equal(other.specialist, 'OTHER');
  assert.match(other.reasons.join(), /Ausweichbesetzung: Fachlehrkraft M\/T statt E\/G/);
  const unknown = teachingSuitability({ ...base, qualificationType: 'SPECIALIST', specialistFields: [] }, egNeed);
  assert.equal(unknown.level, 'REVIEW');
  assert.match(unknown.reasons.join(), /Fachrichtung nicht hinterlegt/);
  for (const qualificationType of ['TEACHER_GS', 'TEACHER_MS']) {
    const teacher = teachingSuitability({ ...base, qualificationType }, egNeed);
    assert.equal(teacher.level, 'REVIEW', qualificationType);
    assert.equal(teacher.specialist, undefined);
    assert.match(teacher.reasons.join(), /Ausweichbesetzung: Lehrkraft – (GS|MS) statt Fachlehrkraft E\/G/);
  }
  assert.equal(teachingSuitability({ ...base, qualificationType: 'SUPPORT' }, egNeed).level, 'REVIEW');
});

test('reserves without qualification status stay provisionally suitable', () => {
  const result = teachingSuitability({ ...base, qualificationType: null }, egNeed);
  assert.equal(result.level, 'MATCH');
  assert.equal(result.specialist, undefined);
});

test('a matching Fachlehrkraft outranks a provisional reserve of the requesting school', () => {
  const common = { hasAllQuals: true, preferredType: 'BOTH', requestedSchoolType: 'GRUNDSCHULE', distance: 30 };
  const specialist = baseMatchScore({ ...common, isStammschule: false, specialist: 'EXACT' });
  const homeSchool = baseMatchScore({ ...common, isStammschule: true, distance: 0 });
  assert.ok(specialist > homeSchool);
});

test('batch planning prefers the matching specialist over a provisional home-school reserve', () => {
  const school = { id: 'school', name: 'Schule', latitude: 49.9, longitude: 11.6 };
  const provisional: BatchTeacher = {
    id: 'home', name: 'Stammreserve', status: 'ACTIVE', stammschuleId: school.id,
    maxWeeklyHours: 28, isPartTime: false, qualifications: '', qualificationType: null,
    preferredType: 'BOTH', homeLat: 49.9, homeLng: 11.6, schoolYear: '2026/2027',
  };
  const specialist = { ...provisional, id: 'specialist', name: 'Fachreserve', stammschuleId: 'other',
    qualificationType: 'SPECIALIST', specialistFields: ['E/G'], homeLat: 49.8 };
  const request = { ...egNeed, id: 'need', schoolId: school.id, date: '2026-10-12',
    hours: 4, weeklyHours: 4, startHour: 1, substitutedTeacher: 'Testperson', status: 'PENDING' };
  const plan = (teachers: BatchTeacher[]) => buildBatchProposal({
    schools: [school], requests: [request], teachers, absences: [], leavePeriods: [],
    today: new Date('2026-10-12T10:00:00Z'), until: new Date('2026-10-12T10:00:00Z'),
  })[0].proposals[0].segments[0];
  for (const teachers of [[provisional, specialist], [specialist, provisional]]) {
    assert.equal(plan(teachers).teacherId, 'specialist');
  }
  // A declared, different Fachrichtung requires confirmation and is never auto-planned.
  assert.equal(plan([provisional, { ...specialist, specialistFields: ['M/T'] }]).teacherId, 'home');
});

test('GS/MS needs and their matching are unchanged for specialists', () => {
  const gsNeed = { requestedSchoolType: 'GRUNDSCHULE', qualifications: 'Grundschule', schoolType: 'GRUNDSCHULE' };
  const result = teachingSuitability({ ...base, qualificationType: 'SPECIALIST', specialistFields: ['E/G'] }, gsNeed);
  assert.equal(result.level, 'REVIEW');
  assert.equal(result.specialist, undefined);
});

const schema = createRequestSchema('2026-01-01');
const request = { schoolId: '123e4567-e89b-12d3-a456-426614174000', date: '2026-05-12', priority: 'UNPLANNED_ABSENCE', startHour: 1, hours: 4, substitutedTeacher: 'Max Mustermann' };

test('Fachlehrkraft requests accept any grade and a normalized Fachrichtung', () => {
  const parsed = schema.safeParse({ ...request, requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: ' e/g ', gradeLevel: 7 });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.requestedSpecialistField, 'E/G');
  assert.equal(schema.safeParse({ ...request, requestedSchoolType: 'FACHLEHRKRAFT', gradeLevel: 2 }).success, true);
});

test('a Fachrichtung requires a Fachlehrkraft need; GS grade checks remain', () => {
  assert.equal(schema.safeParse({ ...request, requestedSchoolType: 'GRUNDSCHULE', requestedSpecialistField: 'E/G' }).success, false);
  assert.equal(schema.safeParse({ ...request, requestedSchoolType: 'GRUNDSCHULE', gradeLevel: 7 }).success, false);
});

test('the Fachrichtung list only counts while the module is enabled', () => {
  assert.deepEqual(activeSpecialistFields({ specialistRequestsEnabled: false, specialistFields: ['E/G'] }), []);
  assert.deepEqual(activeSpecialistFields({ specialistRequestsEnabled: true, specialistFields: ['E/G', 'M/T'] }), ['E/G', 'M/T']);
  assert.deepEqual(specialistFieldListSchema.parse(['e/g', 'E/G ', 'm/t']), ['E/G', 'M/T']);
});

test('normalized codes respect storage and backup length limits, including expanding uppercase letters', () => {
  assert.equal(specialistFieldListSchema.safeParse(['ß'.repeat(21)]).success, false);
  assert.equal(schoolDistrictListSchema.safeParse(['ß'.repeat(26)]).success, false);
  assert.deepEqual(specialistFieldListSchema.parse(['weiß']), ['WEISS']);
});

test('teacher Fachrichtungen are only stored for Fachlehrkräfte of offices using the module', () => {
  const offered = ['E/G', 'M/T'];
  assert.equal(resolveTeacherSpecialistFields({ requested: ['E/G'], qualificationType: 'SPECIALIST', offered: [] }), undefined);
  assert.deepEqual(resolveTeacherSpecialistFields({ requested: ['E/G'], qualificationType: 'TEACHER_GS', offered }), []);
  assert.deepEqual(resolveTeacherSpecialistFields({ requested: ['e/g', 'X'], qualificationType: 'SPECIALIST', offered }), ['E/G']);
  assert.equal(resolveTeacherSpecialistFields({ requested: undefined, qualificationType: 'SPECIALIST', offered }), undefined);
  assert.throws(() => resolveTeacherSpecialistFields({ requested: [], qualificationType: 'SPECIALIST', offered, required: true }), SpecialistFieldRequiredError);
  // Partial updates without a qualification type never touch the stored list.
  assert.equal(resolveTeacherSpecialistFields({ requested: ['E/G'], qualificationType: undefined, offered }), undefined);
});

test('labels and completion prompts mention Fachrichtungen only when relevant', () => {
  assert.equal(requestedDeploymentLabel({ requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: 'E/G' }), 'Fachlehrkraft E/G');
  assert.equal(requestedDeploymentLabel({ requestedSchoolType: 'FACHLEHRKRAFT' }), 'Fachlehrkraft (beliebige Fachrichtung)');
  assert.equal(requestedDeploymentLabel({ requestedSchoolType: 'MITTELSCHULE' }, true), 'MS');
  assert.equal(qualificationTypeLabel({ qualificationType: 'SPECIALIST', specialistFields: ['E/G', 'M/T'] }), 'Fachlehrkraft (E/G, M/T)');
  assert.equal(qualificationTypeLabel({ qualificationType: 'SPECIALIST', specialistFields: [] }), 'Fachlehrkraft');
  const complete = { qualificationType: 'SPECIALIST', canTeachSports: true, specialistFields: [] };
  assert.equal(qualificationCompletionPrompt(complete), null);
  assert.match(qualificationCompletionPrompt(complete, ['E/G']) ?? '', /Fachrichtung/);
  assert.equal(qualificationCompletionPrompt({ ...complete, specialistFields: ['E/G'] }, ['E/G']), null);
});

test('district list: once defined, only listed or unchanged existing values are accepted', () => {
  assert.deepEqual(schoolDistrictListSchema.parse(['btl', ' BT ', 'BT']), ['BT', 'BTL']);
  assert.equal(validateSchoolDistrict('bt land', []), 'BT LAND');
  assert.equal(validateSchoolDistrict(' bt ', ['BT', 'BTL']), 'BT');
  assert.equal(validateSchoolDistrict('', ['BT']), null);
  assert.equal(validateSchoolDistrict('BT LAND', ['BT'], 'BT LAND'), 'BT LAND');
  assert.throws(() => validateSchoolDistrict('Bayreuth', ['BT', 'BTL']), SchoolDistrictNotAllowedError);
});

test('district usage counts spellings across schools and reserves', () => {
  const usage = districtUsage(
    [{ schoolDistrict: 'BT' }, { schoolDistrict: 'BTL' }, { schoolDistrict: null }],
    [{ schoolDistrict: 'BT' }, { schoolDistrict: 'BT LAND' }, { schoolDistrict: 'BT' }],
  );
  assert.deepEqual(usage[0], { value: 'BT', schools: 1, teachers: 2 });
  assert.equal(usage.length, 3);
});
