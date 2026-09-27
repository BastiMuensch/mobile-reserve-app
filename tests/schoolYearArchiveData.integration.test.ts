import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  test('school-year archive loader integration (skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('loader uses Berlin assignment boundaries, date-only report bounds, and fails closed for bad snapshots/assets', async () => {
    const { loadSchoolYearArchiveData } = await import('../src/lib/schoolYearArchiveData');
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const ids = { users: [] as string[], schools: [] as string[], teachers: [] as string[], requests: [] as string[], reports: [] as string[] };
    try {
      const office = await db.user.create({ data: { email: `archive-loader-${suffix}@test.invalid`, password: 'unused', role: 'SCHULAMT' } }); ids.users.push(office.id);
      const school = await db.school.create({ data: { name: 'Grenzschule', address: 'Grenzweg 1', type: 'GRUNDSCHULE', schulamtId: office.id } }); ids.schools.push(school.id);
      const teacher = await db.teacher.create({ data: { name: 'Grenzlehrkraft', stammschuleId: school.id, maxWeeklyHours: 20, qualifications: '', status: 'ACTIVE', preferredType: 'BOTH', homeLat: 0, homeLng: 0, schoolYear: '2025/2026' } }); ids.teachers.push(teacher.id);
      await db.schulamtProfile.create({ data: { userId: office.id, headerText: 'Amt', returnAddress: 'Amtweg 1', contactAddress: 'Amtweg 1', contactPerson: 'Leitung', city: 'Berlin', amtsleitungName: 'Leitung', amtsleitungTitle: 'Amt', documentSubject: 'Einsatz', documentIntro: 'Intro', documentClosing: 'Gruß' } });
      const [included, excluded] = await Promise.all([
        db.request.create({ data: { schoolId: school.id, date: new Date('2025-08-31T22:00:00.000Z'), hours: 2, weeklyHours: 2, schoolType: 'GRUNDSCHULE', substitutedTeacher: 'A', qualifications: '', priority: 'UNPLANNED_ABSENCE', status: 'PENDING' } }),
        db.request.create({ data: { schoolId: school.id, date: new Date('2025-08-31T21:59:59.999Z'), hours: 2, weeklyHours: 2, schoolType: 'GRUNDSCHULE', substitutedTeacher: 'B', qualifications: '', priority: 'UNPLANNED_ABSENCE', status: 'PENDING' } }),
      ]);
      ids.requests.push(included.id, excluded.id);
      await db.assignment.create({ data: { requestId: included.id, teacherId: teacher.id, date: new Date('2025-08-31T22:00:00.000Z'), hours: 2, status: 'ACCEPTED' } });
      const payload = (date: string) => ({ date, office: 'ARCHIV', internalShort: 0, internalLong: 0, reviewed: true, expectedUpdatedAt: null, entries: [{ teacherId: teacher.id, state: 'READY', setting: { category: 'GS_MS', included: true, weeklyHours: 20, effectiveFrom: date } }] });
      const reports = await Promise.all([
        db.governmentReport.create({ data: { schulamtId: office.id, date: new Date('2025-08-31T00:00:00.000Z'), payload: payload('2025-08-31') } }),
        db.governmentReport.create({ data: { schulamtId: office.id, date: new Date('2025-09-01T00:00:00.000Z'), payload: payload('2025-09-01') } }),
        db.governmentReport.create({ data: { schulamtId: office.id, date: new Date('2026-09-01T00:00:00.000Z'), payload: payload('2026-09-01') } }),
      ]); ids.reports.push(...reports.map(report => report.id));
      const data = await loadSchoolYearArchiveData(office.id, '2025/2026');
      assert.deepEqual(data.requests.map(request => request.id), [included.id]);
      assert.equal(data.requests[0].assignments.length, 1);
      assert.deepEqual(data.reports.map(report => report.payload.date), ['2025-09-01']);

      const malformed = await db.governmentReport.create({ data: { schulamtId: office.id, date: new Date('2025-10-01T00:00:00.000Z'), payload: { reviewed: true, unexpected: 'not-a-report' } } }); ids.reports.push(malformed.id);
      await assert.rejects(() => loadSchoolYearArchiveData(office.id, '2025/2026'), /technisch ungültig/);
      await db.governmentReport.delete({ where: { id: malformed.id } }); ids.reports.pop();
      const mismatch = await db.governmentReport.create({ data: { schulamtId: office.id, date: new Date('2025-11-01T00:00:00.000Z'), payload: payload('2025-11-02') } }); ids.reports.push(mismatch.id);
      await assert.rejects(() => loadSchoolYearArchiveData(office.id, '2025/2026'), /abweichenden Stichtag/);
      await db.governmentReport.delete({ where: { id: mismatch.id } }); ids.reports.pop();
      await db.schulamtProfile.update({ where: { userId: office.id }, data: { logoUrl: '/uploads/does-not-exist.png' } });
      await assert.rejects(() => loadSchoolYearArchiveData(office.id, '2025/2026'), /Dokumentenbild/);
      await db.schulamtProfile.update({ where: { userId: office.id }, data: { logoUrl: null } });

      const withoutProfile = await db.user.create({ data: { email: `archive-loader-no-profile-${suffix}@test.invalid`, password: 'unused', role: 'SCHULAMT' } }); ids.users.push(withoutProfile.id);
      await assert.rejects(() => loadSchoolYearArchiveData(withoutProfile.id, '2025/2026'), /Schulamtsprofil/);
    } finally {
      if (ids.reports.length) await db.governmentReport.deleteMany({ where: { id: { in: ids.reports } } });
      if (ids.requests.length) await db.assignment.deleteMany({ where: { requestId: { in: ids.requests } } });
      if (ids.requests.length) await db.request.deleteMany({ where: { id: { in: ids.requests } } });
      if (ids.teachers.length) await db.teacher.deleteMany({ where: { id: { in: ids.teachers } } });
      if (ids.schools.length) await db.school.deleteMany({ where: { id: { in: ids.schools } } });
      if (ids.users.length) await db.user.deleteMany({ where: { id: { in: ids.users } } });
      await db.$disconnect();
    }
  });
}
