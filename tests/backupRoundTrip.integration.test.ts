import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { PrismaClient } from '@prisma/client';

// Next installs this global in its server runtime. Route handlers are invoked
// directly here, so provide the equivalent Node implementation before their
// dynamic imports create request-scoped storage.
if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

const testDbUrl = process.env.TEST_DATABASE_URL;

/** Only imported UUID assets directly under public/uploads are eligible for test cleanup. */
function importedPublicAssetPath(publicDir: string, url: string): string | null {
  const match = /^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpe?g|gif|webp))$/i.exec(url);
  if (!match) return null;
  const baseDir = path.resolve(publicDir);
  const candidate = path.resolve(baseDir, match[1]);
  return path.dirname(candidate) === baseDir ? candidate : null;
}

if (!testDbUrl) {
  test('Backup round trip integration (skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => assert.ok(true));
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'backup-roundtrip-integration-test-secret';
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
  const publicSettingIds = ['publicInstanceName', 'publicSupportContact', 'impressum', 'privacyPolicy', 'loginLogoUrl', 'loginLogoAlt'];

  test('actual import round trip restores tenant data and rolls back a failed import', async () => {
    const { generateBackupData } = await import('../src/lib/backup');
    const { POST } = await import('../src/app/api/backup/import/route');
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const publicDir = path.join(process.cwd(), 'public', 'uploads');
    const privateDir = await mkdtemp(path.join(os.tmpdir(), 'backup-import-test-'));
    const previousPrivateDir = process.env.PRIVATE_UPLOADS_DIR;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52]);
    // Login logos follow the same UUID upload-name rule as production uploads.
    const logo = `${randomUUID()}.png`, image = `backup-${suffix}-school.png`, signature = `backup-${suffix}-signature.png`;
    const files = [path.join(publicDir, logo), path.join(publicDir, image), path.join(privateDir, signature)];
    let adminId = '', outsideId = '';
    // This integration test uses the real global public settings. Preserve any
    // existing test-installation values instead of deleting them during cleanup.
    const previousPublicSettings = await prisma.systemSetting.findMany({ where: { id: { in: publicSettingIds } } });
    process.env.PRIVATE_UPLOADS_DIR = privateDir;
    await mkdir(publicDir, { recursive: true });
    await Promise.all(files.map(file => writeFile(file, png, { flag: 'wx' })));

    const post = async (body: unknown) => {
      const token = await signToken({ id: adminId, sessionVersion: 44 });
      const req = new Request('http://localhost/api/backup/import', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `session_token=${token}` }, body: JSON.stringify(body) });
      const store = createRequestStoreForAPI(req as never, { pathname: '/api/backup/import', search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: '/api/backup/import', forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => POST(req)));
    };
    try {
      const admin = await prisma.user.create({ data: { email: `admin-${suffix}@test.local`, password: 'hash', role: 'SCHULAMT', sessionVersion: 44 } }); adminId = admin.id;
      outsideId = (await prisma.user.create({ data: { email: `outside-${suffix}@test.local`, password: 'hash', role: 'SCHOOL' } })).id;
      const school = await prisma.school.create({ data: { name: 'Backup Schule', address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: adminId, imageUrl: `/uploads/${image}` } });
      const schoolUser = await prisma.user.create({ data: { email: `school-${suffix}@test.local`, password: 'old', role: 'SCHOOL', schoolId: school.id, sessionVersion: 2 } });
      const teacherUser = await prisma.user.create({ data: { email: `teacher-${suffix}@test.local`, password: 'old', role: 'TEACHER', sessionVersion: 3 } });
      const common = { name: 'Test Lehrkraft', email: teacherUser.email, stammschuleId: school.id, userId: teacherUser.id, status: 'ACTIVE', maxWeeklyHours: 28, isPartTime: false, qualifications: 'Grundschule', address: 'Testweg 2', postalCode: '80331', homeLat: 48.1, homeLng: 11.5, preferredType: 'BOTH' };
      const current = await prisma.teacher.create({ data: { ...common, schoolYear: '2026/2027' } });
      const historic = await prisma.teacher.create({ data: { ...common, schoolYear: '2025/2026' } });
      const req = await prisma.request.create({ data: { schoolId: school.id, date: new Date('2026-10-01T00:00:00.000Z'), hours: 4, weeklyHours: 4, schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Test', qualifications: 'Grundschule', priority: 'UNPLANNED_ABSENCE', status: 'PENDING' } });
      await prisma.assignment.create({ data: { requestId: req.id, teacherId: current.id, date: req.date, hours: 4, status: 'ACCEPTED' } });
      await prisma.absence.create({ data: { teacherId: current.id, date: req.date, type: 'UNAVAILABLE', reason: 'Test' } });
      await prisma.leavePeriod.createMany({ data: [{ teacherId: current.id, startDate: req.date, endDate: null, reportedBy: 'TEACHER' }, { teacherId: historic.id, startDate: new Date('2025-12-01T00:00:00.000Z'), endDate: new Date('2025-12-02T00:00:00.000Z'), reportedBy: 'TEACHER' }] });
      await prisma.schulamtProfile.create({ data: { userId: adminId, logoUrl: `/uploads/${logo}`, signatureUrl: `/api/media/${signature}` } });
      await Promise.all([
        { id: 'publicInstanceName', value: 'Test-Schulamt' },
        { id: 'publicSupportContact', value: 'support@test.local' },
        { id: 'impressum', value: 'Test-Impressum' },
        { id: 'privacyPolicy', value: 'Test-Datenschutz' },
        { id: 'loginLogoUrl', value: `/uploads/${logo}` },
        { id: 'loginLogoAlt', value: 'Test-Logo' },
      ].map(setting => prisma.systemSetting.upsert({ where: { id: setting.id }, create: setting, update: { value: setting.value } })));
      const backup = await generateBackupData(adminId);
      assert.equal(backup.version, '2.0'); assert.equal(backup.data.assets.length, 3);
      assert.equal(backup.data.publicInstanceSettings.loginLogoUrl, `/uploads/${logo}`);
      const imported = await post(backup); assert.equal(imported.status, 200, await imported.text());
      const profile = await prisma.schulamtProfile.findUniqueOrThrow({ where: { userId: adminId } });
      const restoredSchool = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
      assert.notEqual(profile.logoUrl, `/uploads/${logo}`); assert.notEqual(profile.signatureUrl, `/api/media/${signature}`); assert.notEqual(restoredSchool.imageUrl, `/uploads/${image}`);
      assert.deepEqual(await readFile(path.join(publicDir, profile.logoUrl!.slice('/uploads/'.length))), png); assert.deepEqual(await readFile(path.join(privateDir, profile.signatureUrl!.slice('/api/media/'.length))), png);
      assert.equal(await prisma.teacher.count({ where: { stammschuleId: school.id } }), 2); assert.equal(await prisma.leavePeriod.count({ where: { teacherId: { in: [current.id, historic.id] } } }), 2); assert.equal(await prisma.assignment.count({ where: { requestId: req.id } }), 1); assert.equal(await prisma.absence.count({ where: { teacherId: current.id } }), 1);
      assert.equal(await prisma.uploadedAsset.count({ where: { url: { in: [profile.logoUrl!, profile.signatureUrl!, restoredSchool.imageUrl!] } } }), 3);
      const restoredPublic = await prisma.systemSetting.findMany({ where: { id: { in: ['publicInstanceName', 'publicSupportContact', 'impressum', 'privacyPolicy', 'loginLogoUrl', 'loginLogoAlt'] } } });
      const restoredPublicValues = new Map(restoredPublic.map(setting => [setting.id, setting.value]));
      assert.equal(restoredPublicValues.get('publicInstanceName'), 'Test-Schulamt');
      assert.equal(restoredPublicValues.get('loginLogoUrl'), profile.logoUrl);
      assert.equal(restoredPublicValues.get('loginLogoAlt'), 'Test-Logo');
      // A pre-settings v1/v2 backup must not blank the current installation's
      // public branding/legal values.
      await prisma.systemSetting.update({ where: { id: 'publicInstanceName' }, data: { value: 'Beibehalten' } });
      const withoutPublicSettings = structuredClone(backup);
      delete (withoutPublicSettings.data as { publicInstanceSettings?: unknown }).publicInstanceSettings;
      const preserved = await post(withoutPublicSettings); assert.equal(preserved.status, 200, await preserved.text());
      assert.equal((await prisma.systemSetting.findUniqueOrThrow({ where: { id: 'publicInstanceName' } })).value, 'Beibehalten');
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: schoolUser.id } })).isActive, false); assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: teacherUser.id } })).isActive, false);
      const profileBeforeFailedImport = await prisma.schulamtProfile.findUniqueOrThrow({ where: { userId: adminId } });
      const before = { public: (await readdir(publicDir)).sort(), private: (await readdir(privateDir)).sort(), logo: profileBeforeFailedImport.logoUrl };
      const bad = structuredClone(backup); bad.data.users.push({ id: randomUUID(), email: `outside-${suffix}@test.local`, name: null, role: 'SCHOOL', isActive: true, sessionVersion: 0, createdAt: new Date(), schoolId: school.id });
      const failed = await post(bad); assert.equal(failed.status, 500);
      assert.deepEqual((await readdir(publicDir)).sort(), before.public); assert.deepEqual((await readdir(privateDir)).sort(), before.private); assert.equal((await prisma.schulamtProfile.findUniqueOrThrow({ where: { userId: adminId } })).logoUrl, before.logo);
    } finally {
      if (adminId) {
        // The import creates fresh UUID filenames. Resolve only records owned by
        // this test tenant and accept only exact direct children of public/uploads.
        const schools = await prisma.school.findMany({
          where: { schulamtId: adminId },
          select: { id: true },
        });
        const schoolIds = schools.map(school => school.id);
        const teachers = await prisma.teacher.findMany({
          where: { stammschuleId: { in: schoolIds } },
          select: { id: true },
        });
        const teacherIds = teachers.map(teacher => teacher.id);
        const requests = await prisma.request.findMany({
          where: { schoolId: { in: schoolIds } },
          select: { id: true },
        });
        const requestIds = requests.map(request => request.id);
        const schoolAccountIds = (await prisma.user.findMany({
          where: { schoolId: { in: schoolIds } },
          select: { id: true },
        })).map(user => user.id);
        const assetOwnerIds = [adminId, ...schoolAccountIds];
        const ownedAssets = await prisma.uploadedAsset.findMany({
          where: { ownerUserId: { in: assetOwnerIds } },
          select: { url: true },
        });
        const importedPublicPaths = ownedAssets
          .map(asset => importedPublicAssetPath(publicDir, asset.url))
          .filter((file): file is string => file !== null);

        await Promise.all(importedPublicPaths.map(file => unlink(file).catch(() => undefined)));

        await prisma.assignment.deleteMany({ where: { requestId: { in: requestIds } } });
        await prisma.absence.deleteMany({ where: { teacherId: { in: teacherIds } } });
        await prisma.leavePeriod.deleteMany({ where: { teacherId: { in: teacherIds } } });
        await prisma.request.deleteMany({ where: { schoolId: { in: schoolIds } } });
        await prisma.uploadedAsset.deleteMany({ where: { ownerUserId: { in: assetOwnerIds } } });
        await prisma.teacher.deleteMany({ where: { stammschuleId: { in: schoolIds } } });
        await prisma.user.updateMany({ where: { schoolId: { in: schoolIds } }, data: { schoolId: null } });
        await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
        await prisma.schulamtProfile.deleteMany({ where: { userId: adminId } });
        await prisma.systemSetting.deleteMany({ where: { id: { in: publicSettingIds } } });
        if (previousPublicSettings.length > 0) {
          await prisma.systemSetting.createMany({
            data: previousPublicSettings.map(setting => ({ id: setting.id, value: setting.value })),
          });
        }
        await prisma.user.deleteMany({ where: { OR: [{ id: outsideId }, { email: { contains: suffix } }] } });
        await prisma.user.deleteMany({ where: { id: adminId } });
      }

      await Promise.all(files.map(file => unlink(file).catch(() => undefined)));
      await rm(privateDir, { recursive: true, force: true });
      if (previousPrivateDir === undefined) delete process.env.PRIVATE_UPLOADS_DIR;
      else process.env.PRIVATE_UPLOADS_DIR = previousPrivateDir;
      await prisma.$disconnect();
    }
  });
}
