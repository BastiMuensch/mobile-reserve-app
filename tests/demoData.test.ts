import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { createDemo, demoDates, models, normalizeDemoSeed } from '../scripts/demo-data.mjs';

test('demo covers every current database model', () => {
  assert.deepEqual([...models].sort(), Prisma.dmmf.datamodel.models.map(model => model.name[0].toLowerCase() + model.name.slice(1)).sort());
});

test('demo dates are fixed weekdays within one school year', () => {
  const { days, year } = demoDates();
  assert.equal(days[0].slice(0, 10), '2026-09-14');
  assert.equal(days.length, 25);
  assert.ok(days.every(day => day.endsWith('T00:00:00.000Z')), 'Canonical database date keys');
  assert.equal(year, '2026/2027');
  assert.ok(days.every(day => ![0, 6].includes(new Date(day).getUTCDay())));
  for (const invalid of ['2026-02-30', 'bad', '2026-09-13', '2026-08-31']) assert.throws(() => demoDates(invalid));
  assert.equal(demoDates('2027-09-13').year, '2027/2028');
});

test('demo is fictitious, internally consistent, and has no cancelled or earlier assignments', async () => {
  const { seed: generated, credentials } = await createDemo();
  const seed = { ...generated, data: generated.data as unknown as {
    user: Prisma.UserCreateManyInput[]; school: Prisma.SchoolCreateManyInput[];
    schoolLocation: Prisma.SchoolLocationCreateManyInput[];
    teacher: Prisma.TeacherCreateManyInput[]; request: Prisma.RequestCreateManyInput[];
    assignment: Prisma.AssignmentCreateManyInput[]; absence: Prisma.AbsenceCreateManyInput[];
    leavePeriod: Prisma.LeavePeriodCreateManyInput[]; schulamtProfile: Prisma.SchulamtProfileCreateManyInput[];
    systemSetting: Prisma.SystemSettingCreateManyInput[]; pushSubscription: Prisma.PushSubscriptionCreateManyInput[];
    emailOutbox: Prisma.EmailOutboxCreateManyInput[];
  } };
  assert.equal(seed.data.school.length, 6);
  assert.equal(seed.data.schoolLocation.length, 2);
  assert.ok(seed.data.school.some(row => row.type === 'GS_MS'));
  assert.deepEqual(new Set(seed.data.teacher.map(row => row.qualificationType)), new Set(['TEACHER_GS', 'TEACHER_MS', 'SPECIALIST', 'SUPPORT']));
  assert.ok(seed.data.teacher.every(row => typeof row.canTeachSports === 'boolean'));
  assert.equal(seed.data.teacher.filter(row => row.onlyStammschule).length, 1);
  for (const teacher of seed.data.teacher.filter(row => row.onlyStammschule)) {
    assert.equal(teacher.preferredType, seed.data.school.find(row => row.id === teacher.stammschuleId)?.type);
  }
  assert.equal(seed.data.teacher.length, 12);
  assert.equal(seed.data.request.length, 25);
  assert.equal(credentials.length, 19);
  assert.equal(new Set(credentials.map(row => row.password)).size, 19);
  assert.ok(credentials.every(row => row.password.length >= 24 && row.email.endsWith('@sonnenhain.example')));
  assert.ok(seed.data.user.every(row => row.password.startsWith('$2') && !JSON.stringify(seed).includes(credentials.find(c => c.email === row.email)!.password)));
  assert.equal(seed.data.teacher.filter(row => row.schoolYear === '2025/2026').length, 1);
  assert.equal(seed.data.teacher.filter(row => row.status === 'PENDING').length, 1);
  assert.equal(seed.data.schulamtProfile[0].mailProvider, 'NONE');
  assert.ok(seed.data.systemSetting.some(row => row.id === 'demoMode' && row.value === 'true'));
  assert.equal(seed.data.pushSubscription.length, 0);
  assert.equal(seed.data.emailOutbox.length, 0);
  assert.equal(seed.data.schulamtProfile[0].documentLegalText, undefined, 'Unchanged Prisma legal-text default');
  for (const request of seed.data.request) {
    assert.ok(['GRUNDSCHULE', 'MITTELSCHULE'].includes(request.schoolType!));
    if (request.locationId) assert.equal(seed.data.schoolLocation.find(row => row.id === request.locationId)?.schoolId, request.schoolId);
    assert.ok(String(request.date) >= '2026-09-14');
    assert.ok(['PENDING', 'PARTIALLY_FILLED', 'FILLED'].includes(request.status));
    const assignments = seed.data.assignment.filter(a => a.requestId === request.id);
    const hours = assignments.reduce((sum, a) => sum + a.hours, 0);
    assert.equal(request.status, hours === 0 ? 'PENDING' : hours === request.hours ? 'FILLED' : 'PARTIALLY_FILLED');
    for (const assignment of assignments) {
      assert.equal(assignment.date, request.date);
      assert.notEqual(assignment.status, 'REJECTED');
      const teacher = seed.data.teacher.find(t => t.id === assignment.teacherId)!;
      assert.equal(teacher.status, 'ACTIVE');
      assert.equal(teacher.schoolYear, seed.schoolYear);
      assert.equal(teacher.isPartTime, false);
      assert.ok(!seed.data.absence.some(a => a.teacherId === teacher.id));
      assert.ok(!seed.data.leavePeriod.some(a => a.teacherId === teacher.id));
    }
  }
  assert.equal(new Set(seed.data.assignment.map(a => `${a.teacherId}:${a.date}`)).size, seed.data.assignment.length);
  const legacy = structuredClone(generated);
  for (const model of ['schoolLocation', 'reserveReportingPeriod', 'governmentReport']) delete legacy.data[model];
  const upgraded = normalizeDemoSeed(legacy);
  assert.deepEqual(upgraded.data.user, generated.data.user, 'Original login hashes and account IDs survive normalization');
  assert.deepEqual(upgraded.data.request, generated.data.request, 'Original dates and requests are unchanged');
  assert.deepEqual(upgraded.data.schoolLocation, []);
  assert.equal(legacy.data.schoolLocation, undefined, 'Does not mutate the original seed');
  assert.throws(() => normalizeDemoSeed({ ...legacy, data: { ...legacy.data, assignment: undefined } }));
  assert.throws(() => normalizeDemoSeed({ ...legacy, data: { ...legacy.data, schoolLocation: null } }));
  assert.throws(() => normalizeDemoSeed({ ...legacy, schoolYear: '2025/2026' }));
});
