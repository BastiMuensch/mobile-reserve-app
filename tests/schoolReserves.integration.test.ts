import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  test('school reserve overview (requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'school-reserves-test-secret';
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('school reserve routes protect tenant and year boundaries, exclude private data, and persist only own preference', async () => {
    const { GET, PATCH } = await import('../src/app/api/school/reserves/route');
    const { signToken } = await import('../src/lib/auth');
    const { getCurrentSchoolYear, getSchoolYearDates } = await import('../src/lib/schoolYear');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = crypto.randomUUID();
    const userIds: string[] = [], schoolIds: string[] = [];
    const invoke = async (userId?: string, body?: unknown) => {
      const token = userId ? await signToken({ id: userId, sessionVersion: 0 }) : '';
      const request = new Request('http://localhost/api/school/reserves?schoolId=forged&year=1900%2F1901', {
        method: body === undefined ? 'GET' : 'PATCH',
        headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const store = createRequestStoreForAPI(request as never, { pathname: '/api/school/reserves', search: new URL(request.url).search }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: '/api/school/reserves', forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => body === undefined ? GET() : PATCH(request)));
    };
    const makeUser = async (name: string, role: string, schoolId?: string) => {
      const user = await prisma.user.create({ data: { email: `${name}-${suffix}@test.local`, password: 'hash', role, schoolId } }); userIds.push(user.id); return user;
    };
    const makeSchool = async (name: string, schulamtId: string) => {
      const school = await prisma.school.create({ data: { name, address: 'Hidden school address', type: 'GRUNDSCHULE', schulamtId, generalInfo: 'Hidden info' } }); schoolIds.push(school.id); return school;
    };
    try {
      const office = await makeUser('office', 'SCHULAMT'), otherOffice = await makeUser('other-office', 'SCHULAMT');
      const home = await makeSchool('Stammschule', office.id), destination = await makeSchool('Einsatzschule', office.id), foreign = await makeSchool('Fremder Mandant', otherOffice.id);
      const schoolUser = await makeUser('school', 'SCHOOL', home.id), otherSchoolUser = await makeUser('other-school', 'SCHOOL', destination.id);
      const schoolYear = getCurrentSchoolYear(), { start } = getSchoolYearDates(schoolYear);
      const makeTeacher = (name: string, stammschuleId: string, year = schoolYear) => prisma.teacher.create({ data: {
        name, stammschuleId, schoolYear: year, status: 'ACTIVE', maxWeeklyHours: 28,
        qualifications: 'Hidden qualifications', email: 'hidden-teacher@test.local', phone: 'Hidden phone',
        address: 'Hidden home address', homeLat: 48, homeLng: 11, preferredType: 'BOTH',
      } });
      const own = await makeTeacher('Eigene Reserve', home.id), idle = await makeTeacher('Noch ohne Einsatz', home.id);
      const historic = await makeTeacher('Historische Reserve', home.id, '1900/1901'), outsider = await makeTeacher('Fremde Reserve', destination.id);
      const makeRequest = (schoolId: string, status = 'FILLED') => prisma.request.create({ data: {
        schoolId, date: start, hours: 3, status, substitutedTeacher: 'Hidden substituted teacher', comments: 'Hidden medical comment', qualifications: 'Hidden request qualifications',
      } });
      const request = await makeRequest(destination.id), foreignRequest = await makeRequest(foreign.id), cancelled = await makeRequest(destination.id, 'CANCELLED');
      await prisma.assignment.createMany({ data: [
        { requestId: request.id, teacherId: own.id, date: start, hours: 3, status: 'ACCEPTED' },
        { requestId: request.id, teacherId: own.id, date: new Date('1900-10-01T00:00:00Z'), hours: 3, status: 'ACCEPTED' },
        { requestId: request.id, teacherId: historic.id, date: start, hours: 3, status: 'ACCEPTED' },
        { requestId: request.id, teacherId: outsider.id, date: start, hours: 3, status: 'ACCEPTED' },
        { requestId: foreignRequest.id, teacherId: own.id, date: new Date(start.getTime() + 86_400_000), hours: 3, status: 'ACCEPTED' },
        { requestId: cancelled.id, teacherId: own.id, date: new Date(start.getTime() + 2 * 86_400_000), hours: 3, status: 'PENDING' },
      ] });
      await prisma.absence.create({ data: { teacherId: own.id, date: start, type: 'UNAVAILABLE', reason: 'Hidden health reason' } });
      assert.equal((await invoke()).status, 401);
      assert.equal((await invoke(office.id)).status, 403);
      assert.equal((await invoke(office.id, { reserveNotificationsEnabled: true })).status, 403);
      const response = await invoke(schoolUser.id);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const text = await response.text();
      assert.doesNotMatch(text, /Hidden|Historische|Fremder Mandant|Fremde Reserve|hidden-teacher|1900/);
      const data = JSON.parse(text);
      assert.equal(data.schoolYear, schoolYear);
      assert.equal(data.notificationEmail, schoolUser.email);
      assert.equal(data.reserveNotificationsEnabled, false);
      assert.deepEqual(data.teachers.map((teacher: { id: string }) => teacher.id).sort(), [own.id, idle.id].sort());
      const assignments = data.teachers.find((teacher: { id: string }) => teacher.id === own.id).assignments;
      assert.equal(assignments.length, 2);
      assert.ok(assignments.some((assignment: { confirmation: string }) => assignment.confirmation === 'REJECTED'));
      assert.equal(data.teachers.find((teacher: { id: string }) => teacher.id === idle.id).assignments.length, 0);
      assert.equal((await invoke(schoolUser.id, { reserveNotificationsEnabled: true, schoolId: destination.id })).status, 400);
      assert.equal((await invoke(schoolUser.id, { reserveNotificationsEnabled: 'true' })).status, 400);
      assert.equal((await invoke(schoolUser.id, { reserveNotificationsEnabled: true })).status, 200);
      assert.equal((await prisma.school.findUniqueOrThrow({ where: { id: home.id } })).reserveNotificationsEnabled, true);
      assert.equal((await prisma.school.findUniqueOrThrow({ where: { id: destination.id } })).reserveNotificationsEnabled, false);
      assert.equal((await (await invoke(otherSchoolUser.id)).json()).teachers.length, 1);
      assert.equal((await invoke(schoolUser.id, { reserveNotificationsEnabled: false })).status, 200);
      // Two unowned schools do not constitute a shared tenant.
      await prisma.school.updateMany({ where: { id: { in: [home.id, foreign.id] } }, data: { schulamtId: null } });
      const unowned = await (await invoke(schoolUser.id)).json();
      assert.equal(unowned.teachers.length, 2);
      assert.ok(unowned.teachers.every((teacher: { assignments: unknown[] }) => teacher.assignments.length === 0));
    } finally {
      await prisma.assignment.deleteMany({ where: { teacher: { stammschuleId: { in: schoolIds } } } });
      await prisma.absence.deleteMany({ where: { teacher: { stammschuleId: { in: schoolIds } } } });
      await prisma.teacher.deleteMany({ where: { stammschuleId: { in: schoolIds } } });
      await prisma.request.deleteMany({ where: { schoolId: { in: schoolIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds }, role: 'SCHOOL' } });
      await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
  });
}
