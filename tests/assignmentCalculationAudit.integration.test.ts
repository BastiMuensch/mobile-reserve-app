import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { validateAndCreateAssignments } from '../src/lib/assignService';

const url = process.env.TEST_DATABASE_URL;
if (!url) test('assignment calculation consistency', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  const db = new PrismaClient({ datasourceUrl: url });
  test.after(() => db.$disconnect());
  test('legacy cancelled assignments consume neither lesson slots nor days nor weekly hours at approval', async t => {
    const office = await db.user.create({ data: { role: 'SCHULAMT', email: `${randomUUID()}@audit.invalid`, password: 'test' } });
    const school = await db.school.create({ data: { name: 'Audit GS', address: 'Test', type: 'GRUNDSCHULE', schulamtId: office.id } });
    const teacher = await db.teacher.create({ data: {
      name: 'Audit Reserve', stammschuleId: school.id, maxWeeklyHours: 2, schoolYear: '2026/2027', qualificationType: 'TEACHER_GS',
      qualifications: 'Grundschule', preferredType: 'BOTH', homeLat: 48, homeLng: 11, status: 'ACTIVE',
      isPartTime: true, schedule: '{"1":[1,2]}',
    } });
    t.after(async () => {
      await db.assignment.deleteMany({ where: { teacherId: teacher.id } });
      await db.request.deleteMany({ where: { schoolId: school.id } });
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.school.delete({ where: { id: school.id } });
      await db.user.delete({ where: { id: office.id } });
    });
    const request = await db.request.create({ data: {
      schoolId: school.id, date: new Date('2026-11-09T00:00:00Z'), hours: 4, startHour: 1, weeklyHours: 4,
      qualifications: 'Grundschule', requestedSchoolType: 'GRUNDSCHULE', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Test', status: 'PENDING',
    } });
    const cancelled = await db.assignment.create({ data: {
      requestId: request.id, teacherId: teacher.id, date: new Date('2026-11-09T00:00:00Z'), hours: 2, lessonHours: '[1,2]', status: 'CANCELLED',
    } });
    await db.assignment.create({ data: {
      requestId: request.id, teacherId: teacher.id, date: new Date('2026-11-10T00:00:00Z'), hours: 20, status: 'CANCELLED',
    } });
    const result = await db.$transaction(tx => validateAndCreateAssignments(tx, {
      requestId: request.id, teacherId: teacher.id, schulamtId: office.id, entries: [{ date: '2026-11-09', hours: 2 }],
    }), { isolationLevel: 'Serializable' });
    assert.equal(result.createdCount, 1);
    assert.equal(result.warning, undefined);
    assert.equal(result.entries[0].lessonHours, '[1,2]');
    assert.equal((await db.assignment.findUniqueOrThrow({ where: { id: cancelled.id } })).status, 'REJECTED', 'retire legacy row so the active-day unique index permits the new assignment');
    assert.equal((await db.request.findUniqueOrThrow({ where: { id: request.id } })).status, 'PARTIALLY_FILLED');
  });
}
