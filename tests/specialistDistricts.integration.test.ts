import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { PrismaClient } from '@prisma/client';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  test('district list and Fachlehrkraft module integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'specialist-integration-test-secret';
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
  process.env.NOTIFICATION_SUPPRESSED = 'true';
  const db = new PrismaClient({ datasources: { db: { url } } });

  test('office district list, district merge and opt-in Fachlehrkraft requests', async t => {
    const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
    t.after(() => hook.deregister());
    const { POST: createRequest, GET: listRequests } = await import('../src/app/api/requests/route');
    const { GET: requestOptions } = await import('../src/app/api/school/request-options/route');
    const { PATCH: saveAssignment } = await import('../src/app/api/schulamt/profile/route');
    const { GET: districtUsage, POST: mergeDistrict } = await import('../src/app/api/schulamt/districts/route');
    const { PATCH: patchTeacher } = await import('../src/app/api/teachers/[id]/route');
    const { GET: ownProfile, PATCH: saveOwnProfile } = await import('../src/app/api/teacher/profile/route');
    const { signToken } = await import('../src/lib/auth');
    const { getCurrentSchoolYear } = await import('../src/lib/schoolYear');
    const { toLocalDateInputValue } = await import('../src/lib/dateKey');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const users: string[] = [];
    const schoolIds: string[] = [];
    const user = async (role: string, schoolId?: string) => {
      const result = await db.user.create({ data: { email: `${randomUUID()}@specialist.test`, password: 'test', role, schoolId } });
      users.push(result.id);
      return result;
    };
    const invoke = async (handler: (req: Request) => Promise<Response>, userId: string, method: string, body?: unknown) => {
      const pathname = '/api/specialist-test';
      const request = new Request(`http://localhost${pathname}`, {
        method, headers: { cookie: `session_token=${await signToken({ id: userId, sessionVersion: 0 })}`, 'content-type': 'application/json', 'x-forwarded-for': randomUUID() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(request)));
    };
    try {
      const office = await user('SCHULAMT');
      const foreignOffice = await user('SCHULAMT');
      const school = await db.school.create({ data: { name: 'Fachlehrkraft-Testschule', address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: office.id, schoolDistrict: 'BT' } });
      const foreignSchool = await db.school.create({ data: { name: 'Fremde Schule', address: 'Testweg 2', type: 'GRUNDSCHULE', schulamtId: foreignOffice.id, schoolDistrict: 'BT LAND' } });
      schoolIds.push(school.id, foreignSchool.id);
      const schoolUser = await user('SCHOOL', school.id);
      const teacherUser = await user('TEACHER');
      const teacherData = { stammschuleId: school.id, schoolYear: getCurrentSchoolYear(), maxWeeklyHours: 28, qualifications: 'Werken', preferredType: 'BOTH', homeLat: 49.9, homeLng: 11.6, status: 'ACTIVE', postalCode: '95444' };
      const teacher = await db.teacher.create({ data: { ...teacherData, name: 'Fachreserve', userId: teacherUser.id, qualificationType: 'SPECIALIST', canTeachSports: false, schoolDistrict: 'BT LAND' } });
      const foreignTeacher = await db.teacher.create({ data: { ...teacherData, name: 'Fremde Reserve', stammschuleId: foreignSchool.id, schoolDistrict: 'BT LAND' } });
      const assignment = { requestUrgencyNoteEnabled: false, reserveShortageMode: false };

      // Module off: no Fachlehrkraft option, server refuses such needs, nothing asked from reserves.
      assert.deepEqual(await (await invoke(requestOptions, schoolUser.id, 'GET')).json(), { requestUrgencyNoteEnabled: false, specialistFields: [] });
      const body = { schoolId: school.id, date: toLocalDateInputValue(), startHour: 1, hours: 4, substitutedTeacher: 'Testperson', gradeLevel: 7, qualifications: 'Fachlehrkraft E/G' };
      assert.equal((await invoke(createRequest, schoolUser.id, 'POST', { ...body, requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: 'E/G', idempotencyKey: randomUUID() })).status, 403);
      assert.deepEqual((await (await invoke(ownProfile, teacherUser.id, 'GET')).json()).specialistFieldOptions, []);
      const ownProfileBody = { qualificationType: 'SPECIALIST', canTeachSports: false, address: 'Reservestraße 1, 95444 Bayreuth', postalCode: '95444', homeLat: 49.9, homeLng: 11.6 };
      assert.equal((await invoke(saveOwnProfile, teacherUser.id, 'PATCH', ownProfileBody)).status, 200, 'without the module no Fachrichtung is required');

      // Switching the module on starts with E/G and M/T.
      const enabled = await invoke(saveAssignment, office.id, 'PATCH', { ...assignment, specialistRequestsEnabled: true });
      assert.equal(enabled.status, 200);
      assert.deepEqual((await enabled.json()).profile.specialistFields, ['E/G', 'M/T']);
      assert.deepEqual(await (await invoke(requestOptions, schoolUser.id, 'GET')).json(), { requestUrgencyNoteEnabled: false, specialistFields: ['E/G', 'M/T'] });
      assert.equal((await invoke(saveAssignment, office.id, 'PATCH', { ...assignment, specialistFields: ['x'.repeat(41)] })).status, 400);

      assert.equal((await invoke(createRequest, schoolUser.id, 'POST', { ...body, requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: 'X/Y', idempotencyKey: randomUUID() })).status, 400);
      assert.equal((await invoke(createRequest, schoolUser.id, 'POST', { ...body, requestedSchoolType: 'GRUNDSCHULE', requestedSpecialistField: 'E/G', gradeLevel: 2, idempotencyKey: randomUUID() })).status, 400);
      const created = await invoke(createRequest, schoolUser.id, 'POST', { ...body, requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: 'e/g', idempotencyKey: randomUUID() });
      assert.equal(created.status, 201);
      const stored = await db.request.findUniqueOrThrow({ where: { id: (await created.json()).id } });
      assert.equal(stored.requestedSchoolType, 'FACHLEHRKRAFT');
      assert.equal(stored.requestedSpecialistField, 'E/G');
      assert.equal(stored.gradeLevel, 7);
      const anyField = await invoke(createRequest, schoolUser.id, 'POST', { ...body, requestedSchoolType: 'FACHLEHRKRAFT', idempotencyKey: randomUUID() });
      assert.equal(anyField.status, 201);
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: (await anyField.json()).id } })).requestedSpecialistField, null);

      // Reserves are asked for their Fachrichtung now; only offered values are stored.
      assert.deepEqual((await (await invoke(ownProfile, teacherUser.id, 'GET')).json()).specialistFieldOptions, ['E/G', 'M/T']);
      assert.equal((await invoke(saveOwnProfile, teacherUser.id, 'PATCH', ownProfileBody)).status, 400);
      assert.equal((await invoke(saveOwnProfile, teacherUser.id, 'PATCH', { ...ownProfileBody, specialistFields: ['e/g', 'Unbekannt'] })).status, 200);
      assert.deepEqual((await db.teacher.findUniqueOrThrow({ where: { id: teacher.id } })).specialistFields, ['E/G']);
      await db.assignment.create({ data: { requestId: stored.id, teacherId: teacher.id, date: stored.date, hours: 4, status: 'ACCEPTED' } });
      const schoolRequests = await (await invoke(listRequests, schoolUser.id, 'GET')).json();
      const visibleTeacher = schoolRequests.find((request: { id: string }) => request.id === stored.id).assignments[0].teacher;
      assert.deepEqual(visibleTeacher.specialistFields, ['E/G'], 'schools see the assigned reserve’s Fachrichtung');
      assert.equal(visibleTeacher.address, undefined, 'private address remains excluded');
      assert.equal((await invoke(saveOwnProfile, teacherUser.id, 'PATCH', { ...ownProfileBody, qualificationType: 'TEACHER_GS' })).status, 200);
      assert.deepEqual((await db.teacher.findUniqueOrThrow({ where: { id: teacher.id } })).specialistFields, [], 'only Fachlehrkräfte keep Fachrichtungen');

      // District list: free text until the office defines one, then only listed values.
      const teacherPatch = (req: Request) => patchTeacher(req, { params: Promise.resolve({ id: teacher.id }) });
      assert.equal((await invoke(teacherPatch, office.id, 'PATCH', { schoolDistrict: 'Bayreuth Stadt' })).status, 200);
      const saved = await invoke(saveAssignment, office.id, 'PATCH', { ...assignment, schoolDistricts: ['btl', ' bt '] });
      assert.deepEqual((await saved.json()).profile.schoolDistricts, ['BT', 'BTL']);
      assert.equal((await invoke(teacherPatch, office.id, 'PATCH', { schoolDistrict: 'Pegnitz' })).status, 400);
      assert.equal((await invoke(teacherPatch, office.id, 'PATCH', { schoolDistrict: 'Bayreuth Stadt' })).status, 200, 'an unchanged legacy value stays editable');
      assert.equal((await invoke(teacherPatch, office.id, 'PATCH', { schoolDistrict: 'btl' })).status, 200);
      await db.teacher.update({ where: { id: teacher.id }, data: { schoolDistrict: 'BT LAND' } });

      const usage = await (await invoke(districtUsage, office.id, 'GET')).json();
      assert.deepEqual(usage.usage.map((entry: { value: string }) => entry.value).sort(), ['BT', 'BT LAND']);
      assert.equal((await invoke(districtUsage, schoolUser.id, 'GET')).status, 403);
      assert.equal((await invoke(mergeDistrict, office.id, 'POST', { from: 'BT LAND', to: 'PEG' })).status, 400, 'targets must be on the saved list');
      const merged = await invoke(mergeDistrict, office.id, 'POST', { from: 'BT LAND', to: 'btl' });
      assert.equal(merged.status, 200);
      assert.equal((await merged.json()).teachers, 1);
      assert.equal((await db.teacher.findUniqueOrThrow({ where: { id: teacher.id } })).schoolDistrict, 'BTL');
      assert.equal((await db.teacher.findUniqueOrThrow({ where: { id: foreignTeacher.id } })).schoolDistrict, 'BT LAND', 'another office is never touched');
      assert.equal((await db.school.findUniqueOrThrow({ where: { id: foreignSchool.id } })).schoolDistrict, 'BT LAND');

      // Switching the module off hides it again without deleting stored data.
      await invoke(saveAssignment, office.id, 'PATCH', { ...assignment, specialistRequestsEnabled: false });
      assert.deepEqual((await (await invoke(requestOptions, schoolUser.id, 'GET')).json()).specialistFields, []);
      assert.deepEqual((await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } })).specialistFields, ['E/G', 'M/T']);
    } finally {
      await db.emailOutbox.deleteMany({ where: { schulamtId: { in: users } } });
      await db.assignment.deleteMany({ where: { request: { schoolId: { in: schoolIds } } } });
      await db.request.deleteMany({ where: { schoolId: { in: schoolIds } } });
      await db.teacher.deleteMany({ where: { stammschuleId: { in: schoolIds } } });
      await db.user.deleteMany({ where: { schoolId: { in: schoolIds } } });
      await db.schulamtProfile.deleteMany({ where: { userId: { in: users } } });
      await db.school.deleteMany({ where: { id: { in: schoolIds } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  });
}
