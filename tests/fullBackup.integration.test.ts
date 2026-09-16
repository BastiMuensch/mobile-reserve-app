import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { extractBackup, restoreDatabase } from '../scripts/restore-full-backup.mjs';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl) {
  test('full encrypted backup integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(new URL(sourceUrl).pathname, /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = sourceUrl;
  process.env.JWT_SECRET = 'full-backup-integration-test-only';
  process.env.SMTP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.INVITATION_TOKEN_PEPPER = 'integration-invitation-pepper';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost';
  process.env.APP_VERSION = '0.1.8';
  const db = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  test('real authenticated download restores all tables, hashes, SMTP secret, settings and files into an empty database', async () => {
    const { POST, GET } = await import('../src/app/api/backup/export/route');
    const { signToken } = await import('../src/lib/auth');
    const { protectSecret, revealSecret } = await import('../src/lib/secrets');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = randomUUID().replaceAll('-', '');
    const targetName = `mr_test_restore_${suffix}`;
    assert.match(targetName, /^mr_test_restore_[a-f0-9]{32}$/);
    const targetUrl = new URL(sourceUrl); targetUrl.pathname = `/${targetName}`;
    const temp = await mkdtemp(path.join(os.tmpdir(), 'full-backup-integration-'));
    const privateDir = path.join(temp, 'signatures'); await mkdir(privateDir);
    const oldPrivateDir = process.env.PRIVATE_UPLOADS_DIR; process.env.PRIVATE_UPLOADS_DIR = privateDir;
    const publicDir = path.join(process.cwd(), 'public/uploads'); await mkdir(publicDir, { recursive: true });
    const image = `${randomUUID()}.png`, signature = `${randomUUID()}.png`;
    const publicFile = path.join(publicDir, image);
    await writeFile(publicFile, 'test-logo'); await writeFile(path.join(privateDir, signature), 'test-signature');
    let target: PrismaClient | null = null;
    const userIds: string[] = []; let schoolId = '', teacherId = '', requestId = '', settingId = '', outboxId = '';
    const password = 'a-test-password-only', backupPassword = randomBytes(24).toString('base64url');
    const invoke = async (userId: string | null, body: unknown, origin = 'http://localhost', method = 'POST') => {
      const cookie = userId ? `session_token=${await signToken({ id: userId, sessionVersion: 0 })}` : '';
      const req = new Request('http://localhost/api/backup/export', { method, headers: { cookie, origin, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
      const store = createRequestStoreForAPI(req as never, { pathname: '/api/backup/export', search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: '/api/backup/export', forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => method === 'GET' ? GET() : POST(req)));
    };
    try {
      const hash = await bcrypt.hash(password, 10);
      for (const role of ['SCHULAMT', 'SCHOOL', 'TEACHER']) userIds.push((await db.user.create({ data: { role, email: `${role}-${suffix}@test.invalid`, password: hash } })).id);
      schoolId = (await db.school.create({ data: { schulamtId: userIds[0], name: 'Backup-Testschule', address: 'Testweg', type: 'GRUNDSCHULE', imageUrl: `/uploads/${image}` } })).id;
      await db.user.update({ where: { id: userIds[1] }, data: { schoolId } });
      teacherId = (await db.teacher.create({ data: { name: 'Backup-Testreserve', userId: userIds[2], stammschuleId: schoolId, maxWeeklyHours: 20, qualifications: '', status: 'ACTIVE', preferredType: 'BOTH', homeLat: 48, homeLng: 10, schoolYear: '2025/2026' } })).id;
      requestId = (await db.request.create({ data: { schoolId, date: new Date('2026-07-01'), hours: 4, substitutedTeacher: 'Test', qualifications: '', status: 'FILLED' } })).id;
      await db.assignment.create({ data: { teacherId, requestId, date: new Date('2026-07-01'), hours: 4, status: 'ACCEPTED' } });
      await db.schulamtProfile.create({ data: { userId: userIds[0], smtpPass: protectSecret('smtp-test-secret'), signatureUrl: `/api/media/${signature}` } });
      await db.teacherInvitation.create({ data: { schulamtId: userIds[0], recipientEmail: 'test@example.invalid', tokenHash: suffix, expiresAt: new Date('2027-01-01') } });
      await db.passwordResetToken.create({ data: { userId: userIds[2], tokenHash: suffix, expiresAt: new Date('2027-01-01') } });
      await db.pushSubscription.create({ data: { userId: userIds[2], endpoint: `https://test.invalid/${suffix}`, p256dh: 'test', auth: 'test' } });
      settingId = `test-full-backup-${suffix}`; await db.systemSetting.create({ data: { id: settingId, value: 'private-vapid-test-value' } });
      outboxId = (await db.emailOutbox.create({ data: { schulamtId: userIds[0], payloadEncrypted: protectSecret('outbox-test-data') } })).id;
      assert.equal((await invoke(null, {})).status, 403);
      for (const id of userIds.slice(1)) assert.equal((await invoke(id, { password, backupPassword })).status, 403);
      assert.equal((await invoke(userIds[0], {}, 'https://foreign.invalid')).status, 403);
      assert.equal((await invoke(userIds[0], {}, 'http://localhost', 'GET')).status, 405);
      assert.equal((await invoke(userIds[0], { password: 'wrong', backupPassword })).status, 401);
      const response = await invoke(userIds[0], { password, backupPassword });
      assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
      assert.match(response.headers.get('cache-control')!, /no-store/);
      assert.equal(response.headers.get('content-type'), 'application/octet-stream');
      assert.ok(!(JSON.stringify([...response.headers])).includes(backupPassword));
      const archive = Buffer.from(await response.arrayBuffer());
      assert.ok(!archive.includes(Buffer.from('smtp-test-secret')));
      const file = path.join(temp, 'complete.mrbackup'); await writeFile(file, archive);
      const result = await extractBackup(file, backupPassword, path.join(temp, 'restore'));
      assert.equal(await readFile(path.join(result.directory, 'public-uploads', image), 'utf8'), 'test-logo');
      assert.equal(await readFile(path.join(result.directory, 'custom-signatures', signature), 'utf8'), 'test-signature');
      const env = JSON.parse(await readFile(path.join(result.directory, 'environment.original.json'), 'utf8'));
      assert.equal(env.SMTP_ENCRYPTION_KEY, process.env.SMTP_ENCRYPTION_KEY);
      await db.$executeRawUnsafe(`CREATE DATABASE "${targetName}"`);
      target = new PrismaClient({ datasources: { db: { url: targetUrl.href } } });
      await restoreDatabase(path.join(result.directory, 'database.dump'), targetUrl.href, 'LEERE-ZIELDATENBANK-WIEDERHERSTELLEN');
      for (const id of userIds) { const restoredUser: { password: string } = await target.user.findUniqueOrThrow({ where: { id } }); assert.equal(restoredUser.password, hash); assert.ok(await bcrypt.compare(password, restoredUser.password)); }
      assert.equal(revealSecret((await target.schulamtProfile.findUniqueOrThrow({ where: { userId: userIds[0] } })).smtpPass!), 'smtp-test-secret');
      assert.equal((await target.systemSetting.findUniqueOrThrow({ where: { id: settingId } })).value, 'private-vapid-test-value');
      assert.equal(await target.assignment.count({ where: { teacherId } }), 1);
      assert.equal(await target.teacherInvitation.count({ where: { schulamtId: userIds[0] } }), 1);
      assert.equal(await target.passwordResetToken.count({ where: { userId: userIds[2] } }), 1);
      assert.equal(await target.pushSubscription.count({ where: { userId: userIds[2] } }), 1);
      assert.equal(revealSecret((await target.emailOutbox.findUniqueOrThrow({ where: { id: outboxId } })).payloadEncrypted!), 'outbox-test-data');
      await assert.rejects(restoreDatabase(path.join(result.directory, 'database.dump'), targetUrl.href, 'LEERE-ZIELDATENBANK-WIEDERHERSTELLEN'));
      assert.equal(await target.user.count({ where: { id: { in: userIds } } }), 3, 'refused restore preserves existing data');
      for (let i = 0; i < 3; i++) assert.equal((await invoke(userIds[0], { password: 'wrong', backupPassword })).status, 401);
      assert.equal((await invoke(userIds[0], { password, backupPassword })).status, 429);
      await db.user.update({ where: { id: userIds[0] }, data: { sessionVersion: 1 } });
      assert.equal((await invoke(userIds[0], { password, backupPassword })).status, 403);
    } finally {
      if (target) { await target.$disconnect(); await db.$executeRawUnsafe(`DROP DATABASE "${targetName}"`); }
      if (requestId) { await db.assignment.deleteMany({ where: { requestId } }); await db.request.deleteMany({ where: { id: requestId } }); }
      if (teacherId) await db.teacher.deleteMany({ where: { id: teacherId } });
      if (outboxId) await db.emailOutbox.deleteMany({ where: { id: outboxId } });
      if (settingId) await db.systemSetting.deleteMany({ where: { id: settingId } });
      await db.pushSubscription.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      if (schoolId) await db.school.deleteMany({ where: { id: schoolId } });
      await rm(publicFile, { force: true }); await rm(temp, { recursive: true, force: true });
      if (oldPrivateDir === undefined) delete process.env.PRIVATE_UPLOADS_DIR; else process.env.PRIVATE_UPLOADS_DIR = oldPrivateDir;
      await db.$disconnect();
    }
  });
}
