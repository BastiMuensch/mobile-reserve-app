import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('Export and teacher self-profile HTTP routes (skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => assert.ok(true));
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'export-profile-integration-test-secret';
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('export is tenant/year-bounded and marks rejected assignments as zero active hours; self profile is owner-only', async () => {
    const { GET: exportGet } = await import('../src/app/api/export/route');
    const { GET: profileGet, PATCH: profilePatch } = await import('../src/app/api/teacher/profile/route');
    const { GET: proofGet } = await import('../src/app/api/assignments/[id]/pdf/route');
    const { signToken } = await import('../src/lib/auth');
    const { getCurrentSchoolYear } = await import('../src/lib/schoolYear');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let officeId = '', teacherUserId = '', otherUserId = '', schoolId = '', schoolUserId = '';

    const invoke = async <T extends (request: Request) => Promise<Response>>(handler: T, pathname: string, request: Request) => {
      const store = createRequestStoreForAPI(request as never, { pathname, search: new URL(request.url).search }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () =>
        workUnitAsyncStorage.run(store, () => handler(request)));
    };
    const asUser = async (id: string, version: number, pathname: string, method = 'GET', body?: unknown) => {
      const token = await signToken({ id, sessionVersion: version });
      return new Request(`http://localhost${pathname}`, {
        method,
        headers: { cookie: `session_token=${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    };

    try {
      const office = await prisma.user.create({ data: { email: `export-office-${suffix}@test.local`, password: 'hash', role: 'SCHULAMT', sessionVersion: 7 } }); officeId = office.id;
      const school = await prisma.school.create({ data: { name: `Export Test ${suffix}`, address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: officeId } }); schoolId = school.id;
      const schoolUser = await prisma.user.create({ data: { email: `export-school-${suffix}@test.local`, password: 'hash', role: 'SCHOOL', schoolId, sessionVersion: 1 } }); schoolUserId = schoolUser.id;
      await prisma.schulamtProfile.create({ data: { userId: officeId, headerText: 'Schulamt Test', returnAddress: 'Teststraße 1', contactAddress: 'Teststraße 1', contactPerson: 'Alex Test', city: 'Teststadt', amtsleitungName: 'Alex Test', amtsleitungTitle: 'Amtsleitung' } });
      const teacherUser = await prisma.user.create({ data: { email: `profile-owner-${suffix}@test.local`, password: 'hash', role: 'TEACHER', sessionVersion: 3 } }); teacherUserId = teacherUser.id;
      const otherUser = await prisma.user.create({ data: { email: `profile-other-${suffix}@test.local`, password: 'hash', role: 'TEACHER', sessionVersion: 4 } }); otherUserId = otherUser.id;
      const currentYear = getCurrentSchoolYear();
      const [currentTeacher, historicTeacher, otherTeacher] = await Promise.all([
        prisma.teacher.create({ data: { name: 'Owner current', email: teacherUser.email, userId: teacherUserId, stammschuleId: schoolId, status: 'ACTIVE', maxWeeklyHours: 28, isPartTime: false, qualifications: 'Alles', address: 'Current address 1', postalCode: '80331', homeLat: 48.1, homeLng: 11.5, preferredType: 'BOTH', schoolYear: currentYear } }),
        prisma.teacher.create({ data: { name: 'Owner historic', email: teacherUser.email, userId: teacherUserId, stammschuleId: schoolId, status: 'ACTIVE', maxWeeklyHours: 28, isPartTime: false, qualifications: 'Alles', address: 'Historic address 1', postalCode: '80331', homeLat: 48.1, homeLng: 11.5, preferredType: 'BOTH', schoolYear: '2025/2026' } }),
        prisma.teacher.create({ data: { name: 'Other teacher', email: otherUser.email, userId: otherUserId, stammschuleId: schoolId, status: 'ACTIVE', maxWeeklyHours: 28, isPartTime: false, qualifications: 'Alles', address: 'Other address 1', postalCode: '80331', homeLat: 48.1, homeLng: 11.5, preferredType: 'BOTH', schoolYear: currentYear } }),
      ]);
      const oldRequest = await prisma.request.create({ data: { schoolId, date: new Date('2026-05-11T00:00:00.000Z'), hours: 2, weeklyHours: 2, schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Old', qualifications: 'Alles', priority: 'UNPLANNED_ABSENCE', status: 'PENDING' } });
      const otherYearRequest = await prisma.request.create({ data: { schoolId, date: new Date('2026-09-14T00:00:00.000Z'), hours: 2, weeklyHours: 2, schoolType: 'GRUNDSCHULE', substitutedTeacher: 'New', qualifications: 'Alles', priority: 'UNPLANNED_ABSENCE', status: 'PENDING' } });
      await prisma.assignment.createMany({ data: [
        { requestId: oldRequest.id, teacherId: historicTeacher.id, date: new Date('2026-05-11T00:00:00.000Z'), hours: 2, status: 'ACCEPTED' },
        { requestId: oldRequest.id, teacherId: currentTeacher.id, date: new Date('2026-05-12T00:00:00.000Z'), hours: 2, status: 'REJECTED' },
        { requestId: otherYearRequest.id, teacherId: currentTeacher.id, date: new Date('2026-09-14T00:00:00.000Z'), hours: 2, status: 'ACCEPTED' },
      ] });

      const exportResponse = await invoke(exportGet, '/api/export', await asUser(officeId, 7, '/api/export?year=2025%2F2026'));
      if (exportResponse.status !== 200) assert.fail(await exportResponse.text());
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await exportResponse.arrayBuffer());
      const assignmentSheet = workbook.getWorksheet('Einsätze');
      assert.ok(assignmentSheet);
      const rows = assignmentSheet.getSheetValues().slice(2) as unknown[][];
      assert.equal(rows.length, 2, 'only assignments inside the selected school year may export');
      const rejected = rows.find(row => row[5] === 'Storniert');
      assert.ok(rejected, 'the rejected assignment stays auditable');
      assert.equal(rejected[6], 0, 'rejected assignment must contribute zero active hours');

      const proofAssignment = await prisma.assignment.findFirstOrThrow({ where: { requestId: oldRequest.id, status: 'REJECTED' } });
      const proofPath = `/api/assignments/${proofAssignment.id}/pdf`;
      const proofHandler = (request: Request) => proofGet(request, { params: Promise.resolve({ id: proofAssignment.id }) });
      assert.equal((await invoke(proofHandler, proofPath, new Request(`http://localhost${proofPath}`))).status, 401);
      for (const [id, version] of [[schoolUserId, 1], [otherUserId, 4]] as const) {
        assert.equal((await invoke(proofHandler, proofPath, await asUser(id, version, proofPath))).status, 403, 'Neither a school nor another teacher may read the proof');
      }
      for (const [id, version] of [[teacherUserId, 3], [officeId, 7]] as const) {
        const proofResponse = await invoke(proofHandler, proofPath, await asUser(id, version, proofPath));
        assert.equal(proofResponse.status, 200);
        assert.match(proofResponse.headers.get('content-disposition') || '', /STORNIERT_/);
        assert.equal(proofResponse.headers.get('cache-control'), 'private, no-store');
        assert.ok((await proofResponse.arrayBuffer()).byteLength > 1000);
      }

      const ownProfileResponse = await invoke(profileGet, '/api/teacher/profile', await asUser(teacherUserId, 3, '/api/teacher/profile'));
      assert.equal(ownProfileResponse.status, 200);
      assert.equal((await ownProfileResponse.json()).id, currentTeacher.id, 'current year takes precedence over historic profile rows');
      const maliciousPatch = await invoke(profilePatch, '/api/teacher/profile', await asUser(teacherUserId, 3, '/api/teacher/profile', 'PATCH', {
        address: 'Changed address 9', postalCode: '80333', homeLat: 48.2, homeLng: 11.6, status: 'LEAVE', schoolYear: '2099/2100', userId: otherUserId,
      }));
      assert.equal(maliciousPatch.status, 400, 'strict allow-list rejects lifecycle, year, and foreign identity fields');
      assert.equal((await prisma.teacher.findUniqueOrThrow({ where: { id: otherTeacher.id } })).address, 'Other address 1', 'one teacher cannot alter another profile');
      const validPatch = await invoke(profilePatch, '/api/teacher/profile', await asUser(teacherUserId, 3, '/api/teacher/profile', 'PATCH', {
        address: 'Changed address 9', postalCode: '80333', homeLat: 48.2, homeLng: 11.6, phone: '089 123456',
      }));
      assert.equal(validPatch.status, 200, await validPatch.text());
      const ownedRows = await prisma.teacher.findMany({ where: { userId: teacherUserId } });
      assert.ok(ownedRows.every(row => row.address === 'Changed address 9' && row.postalCode === '80333'));
    } finally {
      if (schoolUserId) await prisma.user.delete({ where: { id: schoolUserId } });
      if (schoolId) {
        await prisma.assignment.deleteMany({ where: { request: { schoolId } } });
        await prisma.request.deleteMany({ where: { schoolId } });
        await prisma.teacher.deleteMany({ where: { stammschuleId: schoolId } });
        await prisma.school.delete({ where: { id: schoolId } });
      }
      await prisma.user.deleteMany({ where: { id: { in: [officeId, teacherUserId, otherUserId].filter(Boolean) } } });
      await prisma.$disconnect();
    }
  });
}
