import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PrismaClient } from '@prisma/client';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  test('school locations HTTP integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'locations-integration-secret';
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
  test('multiple school locations, authorization, explicit selection, deactivation and backup round trip', async t => {
    const hook = registerHooks({ resolve: (specifier, context, nextResolve) => nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
    t.after(() => hook.deregister());
    const { POST, PATCH } = await import('../src/app/api/schools/locations/route');
    const { POST: createRequest, GET: getRequests } = await import('../src/app/api/requests/route');
    const { GET: schools } = await import('../src/app/api/schools/route');
    const { POST: importBackup } = await import('../src/app/api/backup/import/route');
    const { generateBackupData } = await import('../src/lib/backup');
    const { signToken, getFullSessionUser } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'school-location-images-'));
    const previousUploads = process.env.PUBLIC_UPLOADS_DIR;
    const previousKey = process.env.SMTP_ENCRYPTION_KEY;
    process.env.PUBLIC_UPLOADS_DIR = mediaDir;
    process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');
    const users: string[] = [], schoolIds: string[] = [];
    const invoke = async (handler: (request: Request) => Promise<Response>, userId: string | null, method: string, body?: unknown, pathname = '/api/schools/locations') => {
      const cookie = userId ? `session_token=${await signToken({ id: userId, sessionVersion: 0 })}` : '';
      const req = new Request(`http://localhost${pathname}`, { method, headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const store = createRequestStoreForAPI(req as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => handler(req)));
    };
    try {
      for (const role of ['SCHULAMT', 'SCHULAMT', 'TEACHER']) users.push((await db.user.create({ data: { email: `${randomUUID()}@test.invalid`, password: 'hash', role } })).id);
      const [office, foreignOffice, teacherUser] = users;
      await db.schulamtProfile.create({ data: { userId: office, mailProvider: 'NONE' } });
      for (const schulamtId of [office, foreignOffice]) schoolIds.push((await db.school.create({ data: { name: 'Testschule', address: 'Hauptstraße 1', type: 'GRUNDSCHULE', latitude: 48, longitude: 11, schulamtId } })).id);
      const [schoolId, foreignSchoolId] = schoolIds;
      const schoolUser = (await db.user.create({ data: { email: `${randomUUID()}@test.invalid`, password: 'hash', role: 'SCHOOL', schoolId } })).id;
      users.push(schoolUser);
      const fields = { schoolId, name: 'Außenstelle West', address: 'Weststraße 20', latitude: 49, longitude: 12, generalInfo: 'Am Westeingang melden', entranceLat: 49.01, entranceLng: 12.01, parkingLat: 49.02, parkingLng: 12.02 };
      assert.equal((await invoke(POST, null, 'POST', fields)).status, 401);
      assert.equal((await invoke(POST, foreignOffice, 'POST', fields)).status, 403);
      assert.equal((await invoke(POST, teacherUser, 'POST', fields)).status, 403);
      assert.equal((await invoke(POST, schoolUser, 'POST', { ...fields, schoolId: foreignSchoolId })).status, 403);
      assert.equal((await invoke(POST, schoolUser, 'POST', { ...fields, imageUrl: '/uploads/foreign.png' })).status, 403);
      const created = await invoke(POST, schoolUser, 'POST', fields);
      assert.equal(created.status, 201, await created.clone().text());
      const location = (await created.json()).location;
      const secondResponse = await invoke(POST, office, 'POST', { ...fields, name: 'Außenstelle Ost', address: 'Oststraße 10' });
      assert.equal(secondResponse.status, 201);
      const second = (await secondResponse.json()).location;
      const hydrated = await invoke(async () => Response.json(await getFullSessionUser()), schoolUser, 'GET');
      assert.equal((await hydrated.json()).school.locations.length, 2);
      const directory = await invoke(schools, office, 'GET');
      assert.equal((await directory.json())[0].locations.length, 2);

      const future = new Date(); future.setDate(future.getDate() + 7);
      while ([0, 6].includes(future.getDay())) future.setDate(future.getDate() + 1);
      const { toLocalDateInputValue } = await import('../src/lib/dateKey');
      const request = { schoolId, date: toLocalDateInputValue(future), priority: 'UNPLANNED_ABSENCE', startHour: 1, hours: 2, weeklyHours: 2, substitutedTeacher: 'Test', qualifications: '', comments: '', idempotencyKey: randomUUID() };
      const demand = (body: unknown) => invoke(createRequest, schoolUser, 'POST', body, '/api/requests');
      assert.equal((await demand(request)).status, 400, 'explicit location required for multi-site school');
      const foreignLocation = await db.schoolLocation.create({ data: { ...fields, schoolId: foreignSchoolId } });
      assert.equal((await demand({ ...request, locationId: foreignLocation.id })).status, 400);
      const savedResponse = await demand({ ...request, locationId: location.id });
      assert.equal(savedResponse.status, 201, await savedResponse.clone().text());
      const saved = await savedResponse.json();
      assert.equal(saved.locationId, location.id);
      assert.equal((await demand({ ...request, locationId: second.id })).status, 409, 'retry key includes location');
      assert.equal((await demand({ ...request, locationId: location.id })).status, 200);
      assert.equal((await demand({ ...request, idempotencyKey: randomUUID(), locationId: null })).status, 201, 'explicit main-site choice');

      assert.equal((await invoke(PATCH, schoolUser, 'PATCH', { ...location, isActive: false })).status, 200);
      assert.equal((await demand({ ...request, idempotencyKey: randomUUID(), locationId: location.id })).status, 400);
      assert.equal((await demand({ ...request, locationId: location.id })).status, 200, 'committed retry still works after deactivation');
      const listing = await invoke(getRequests, schoolUser, 'GET', undefined, `/api/requests?year=${future.getMonth() >= 8 ? future.getFullYear() : future.getFullYear() - 1}/${future.getMonth() >= 8 ? future.getFullYear() + 1 : future.getFullYear()}`);
      const listed = (await listing.json()).find((row: { id: string }) => row.id === saved.id);
      assert.equal(listed.location.address, fields.address);
      assert.equal(listed.location.isActive, false);
      await assert.rejects(db.schoolLocation.delete({ where: { id: location.id } }), 'used location cannot be deleted');
      await assert.rejects(db.request.update({ where: { id: saved.id }, data: { locationId: foreignLocation.id } }), 'database enforces school/location consistency');

      const filename = `${randomUUID()}.png`;
      const imageUrl = `/uploads/${filename}`;
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52]);
      await writeFile(path.join(mediaDir, filename), png);
      await db.uploadedAsset.create({ data: { ownerUserId: schoolUser, url: imageUrl, purpose: 'school_image', createdAt: new Date(Date.now() - 10 * 86400000) } });
      assert.equal((await invoke(PATCH, schoolUser, 'PATCH', { ...location, isActive: false, imageUrl })).status, 200);
      const { cleanupOrphanedUploadedAssets } = await import('../src/lib/mediaStorage');
      await cleanupOrphanedUploadedAssets();
      assert.deepEqual(await readFile(path.join(mediaDir, filename)), png, 'referenced outside-site image survives cleanup');

      // Exercise the real notification builder without attempting SMTP delivery.
      const { enqueueAssignmentEmailsInTransaction } = await import('../src/lib/assignService');
      const { revealSecret } = await import('../src/lib/secrets');
      await db.schulamtProfile.update({ where: { userId: office }, data: { mailProvider: 'SMTP' } });
      const assignedRequest = await db.request.findUniqueOrThrow({ where: { id: saved.id }, include: { location: true, school: { include: { user: true } } } });
      const queued = await db.$transaction(tx => enqueueAssignmentEmailsInTransaction(tx, {
        schulamtId: office, teacher: { id: randomUUID(), name: 'Testreserve', email: 'reserve@test.invalid', userId: null },
        request: assignedRequest, entries: [{ date: request.date, hours: 2 }],
      }));
      assert.equal(queued.outboxIds.length, 2);
      const mail = await db.emailOutbox.findMany({ where: { id: { in: queued.outboxIds } } });
      for (const row of mail) {
        const payload = JSON.parse(revealSecret(row.payloadEncrypted!));
        assert.match(payload.body, /Testschule · Außenstelle West/);
        assert.match(payload.body, /Weststraße 20/);
        assert.doesNotMatch(payload.body, /Hauptstraße 1/);
        if (payload.attachments?.length) assert.match(payload.attachments[0].content, /LOCATION:Weststraße 20/);
      }
      await db.schulamtProfile.update({ where: { userId: office }, data: { mailProvider: 'NONE' } });
      const backup = await generateBackupData(office);
      assert.equal(backup.data.assets.length, 1);
      assert.equal(backup.data.schoolLocations.length, 2);
      const invalid = structuredClone(backup);
      invalid.data.requests.find(row => row.id === saved.id)!.locationId = foreignLocation.id;
      assert.equal((await invoke(importBackup, office, 'POST', invalid, '/api/backup/import')).status, 400);
      const restored = await invoke(importBackup, office, 'POST', backup, '/api/backup/import');
      assert.equal(restored.status, 200, await restored.clone().text());
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: saved.id }, include: { location: true } })).location?.name, fields.name);
      const restoredLocation = await db.schoolLocation.findUniqueOrThrow({ where: { id: location.id } });
      assert.equal(restoredLocation.isActive, false);
      assert.deepEqual(await readFile(path.join(mediaDir, restoredLocation.imageUrl!.slice('/uploads/'.length))), png);
    } finally {
      if (previousUploads === undefined) delete process.env.PUBLIC_UPLOADS_DIR; else process.env.PUBLIC_UPLOADS_DIR = previousUploads;
      if (previousKey === undefined) delete process.env.SMTP_ENCRYPTION_KEY; else process.env.SMTP_ENCRYPTION_KEY = previousKey;
      await rm(mediaDir, { recursive: true, force: true });
      await db.request.deleteMany({ where: { schoolId: { in: schoolIds } } });
      await db.emailOutbox.deleteMany({ where: { schulamtId: { in: users } } });
      await db.user.deleteMany({ where: { schoolId: { in: schoolIds } } });
      await db.school.deleteMany({ where: { id: { in: schoolIds } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
      const { prisma } = await import('../src/lib/prisma');
      await prisma.$disconnect();
    }
  });
}
