import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { createDemo, demoDates } from '../scripts/demo-data.mjs';

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
    teacher: Prisma.TeacherCreateManyInput[]; request: Prisma.RequestCreateManyInput[];
    assignment: Prisma.AssignmentCreateManyInput[]; absence: Prisma.AbsenceCreateManyInput[];
    leavePeriod: Prisma.LeavePeriodCreateManyInput[]; schulamtProfile: Prisma.SchulamtProfileCreateManyInput[];
    systemSetting: Prisma.SystemSettingCreateManyInput[]; pushSubscription: Prisma.PushSubscriptionCreateManyInput[];
    emailOutbox: Prisma.EmailOutboxCreateManyInput[];
  } };
  assert.equal(seed.data.school.length, 6);
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
});
