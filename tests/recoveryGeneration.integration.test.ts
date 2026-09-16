import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { createFullBackup } from '../scripts/full-backup-runtime.mjs';
import { encryptBackup } from '../scripts/full-backup-format.mjs';
import { inspectArchive, restoreGeneration } from '../scripts/recovery-generation.mjs';

const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl) {
  test('recovery generation integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(new URL(sourceUrl).pathname, /(?:^|[_-])test(?:[_-]|$)/i);
  test('actual PostgreSQL dump stages a restricted generation with private files and secrets', async () => {
    const db = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
    const work = await mkdtemp(path.join(os.tmpdir(), 'recovery-generation-integration-'));
    const id = randomBytes(16).toString('hex'), role = `mr_web_${id}`, database = `mr_restore_${id}`;
    const publicRoot = path.join(work, 'public-uploads'), privateRoot = path.join(work, 'private-uploads');
    const archive = path.join(work, 'backup.mrbackup'), dataRoot = path.join(work, 'private-recovery-staging'), outputDataRoot = path.join(work, 'shared-recovery-runtime');
    const password = randomBytes(24).toString('base64url'), jwt = randomBytes(24).toString('base64url');
    let userId = '', originalSessionVersion = 0, passwordHash = '';
    try {
      await mkdir(path.join(privateRoot, 'signatures'), { recursive: true }); await mkdir(publicRoot, { recursive: true });
      await mkdir(path.join(dataRoot, 'generations'), { recursive: true, mode: 0o700 });
      await mkdir(path.join(outputDataRoot, 'generations'), { recursive: true, mode: 0o700 });
      await writeFile(path.join(publicRoot, 'logo.png'), 'public-image'); await writeFile(path.join(privateRoot, 'signatures', 'sig.png'), 'private-image');
      passwordHash = await bcrypt.hash('test-only-password', 10);
      const sourceUser = await db.user.create({ data: { email: `generation-${id}@test.invalid`, password: passwordHash, role: 'SCHULAMT', isActive: true } });
      userId = sourceUser.id; originalSessionVersion = sourceUser.sessionVersion;
      const environment = { DATABASE_URL: sourceUrl, JWT_SECRET: jwt, SMTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), INVITATION_TOKEN_PEPPER: randomBytes(24).toString('hex'), SETUP_TOKEN: 'source-only', CRON_SECRET: 'source-only', NEXT_PUBLIC_APP_URL: 'https://source.invalid' };
      const payload = await db.$transaction(async tx => {
        const [snapshot] = await tx.$queryRaw<{ snapshot: string, version: string }[]>`SELECT pg_export_snapshot() AS snapshot, current_setting('server_version') AS version`;
        return createFullBackup({ databaseUrl: sourceUrl, snapshot: snapshot.snapshot, postgresVersion: snapshot.version, environment, roots: { 'public-uploads': publicRoot, 'private-uploads': privateRoot }, appVersion: '0.1.8', appCommit: 'test', deploymentCompose: '' });
      }, { isolationLevel: 'RepeatableRead', timeout: 180000 });
      await writeFile(archive, await encryptBackup(payload, password));
      const inspected = await inspectArchive({ file: archive, password, id, dataRoot, appVersion: '0.1.8', appCommit: 'test', migrationsDir: path.join(process.cwd(), 'prisma/migrations') });
      assert.equal(await readFile(path.join(inspected.generationDir, 'public-uploads/logo.png'), 'utf8'), 'public-image');
      const restored = await restoreGeneration({ id, dataRoot, outputDataRoot, adminDatabaseUrl: sourceUrl, migrationsDir: path.join(process.cwd(), 'prisma/migrations') });
      assert.equal(restored.descriptor.environment.JWT_SECRET, jwt);
      assert.match(restored.descriptor.environment.DATABASE_URL, new RegExp(`/${database}(?:\\?|$)`));
      assert.equal(await readFile(path.join(restored.descriptor.privateSignaturesDir, 'sig.png'), 'utf8'), 'private-image');
      const shared = path.join(outputDataRoot, 'generations', id);
      assert.deepEqual((await readdir(shared)).sort(), ['custom-signatures', 'private-uploads', 'public-uploads']);
      for (const name of ['database.dump', 'environment.json', 'restore-marker.json', 'descriptor.json', 'metadata.json']) await assert.rejects(readFile(path.join(shared, name)));
      assert.ok(restored.counts.users >= 1);
      const stage = new PrismaClient({ datasources: { db: { url: restored.descriptor.environment.DATABASE_URL } } });
      try {
        const restoredUser = await stage.user.findUniqueOrThrow({ where: { id: userId } });
        assert.notEqual(restoredUser.sessionVersion, originalSessionVersion, 'all old browser sessions are invalidated after recovery');
        assert.ok(await bcrypt.compare('test-only-password', restoredUser.password));
        assert.equal(restoredUser.password, passwordHash);
      } finally { await stage.$disconnect(); }
      const attributes = await db.$queryRawUnsafe(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = '${role}'`);
      assert.deepEqual(attributes, [{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
      const denied = new URL(restored.descriptor.environment.DATABASE_URL); denied.pathname = new URL(sourceUrl).pathname;
      const limited = new PrismaClient({ datasources: { db: { url: denied.href } } });
      try { await assert.rejects(limited.$queryRawUnsafe('SELECT 1')); } finally { await limited.$disconnect(); }
    } finally {
      // Targets are deterministic, generated only by this test, and never overlap a baseline database.
      await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${database}`).catch(() => undefined);
      await db.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
      if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
      await db.$disconnect(); await rm(work, { recursive: true, force: true });
    }
  });
}
