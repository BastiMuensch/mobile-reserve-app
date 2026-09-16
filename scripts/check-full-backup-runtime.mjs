// Runs inside the actual Linux image in CI, using ONLY the explicit test database.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createFullBackup } from './full-backup-runtime.mjs';
import { encryptBackup, decryptBackup, validatePayload } from './full-backup-format.mjs';
import { writeFile } from 'node:fs/promises';
import { restoreDatabase } from './restore-full-backup.mjs';

const url = new URL(process.env.TEST_DATABASE_URL || '');
assert.match(url.pathname, /(?:^|[_-])test(?:[_-]|$)/i);
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
const targetName = `mr_test_image_${randomBytes(8).toString('hex')}`;
const targetUrl = new URL(url); targetUrl.pathname = `/${targetName}`;
const temp = await mkdtemp(path.join(os.tmpdir(), 'mr-image-backup-'));
let target, user;
try {
  user = await db.user.create({ data: { email: `${targetName}@example.invalid`, role: 'SCHULAMT', password: '$2b$test-preserved-hash' } });
  const payload = await db.$transaction(async tx => {
    const [info] = await tx.$queryRaw`SELECT pg_export_snapshot() AS snapshot, current_setting('server_version') AS version`;
    return createFullBackup({ databaseUrl: url.href, snapshot: info.snapshot, postgresVersion: info.version,
      roots: {}, environment: { DATABASE_URL: url.href }, appVersion: '0.0.0-test', appCommit: 'ci', deploymentCompose: '' });
  }, { isolationLevel: 'RepeatableRead', timeout: 180000 });
  const password = randomBytes(24).toString('base64url');
  const { database } = validatePayload(await decryptBackup(await encryptBackup(payload, password), password));
  const dump = path.join(temp, 'database.dump'); await writeFile(dump, database, { mode: 0o600 });
  await db.$executeRawUnsafe(`CREATE DATABASE "${targetName}"`);
  target = new PrismaClient({ datasources: { db: { url: targetUrl.href } } });
  await restoreDatabase(dump, targetUrl.href, 'LEERE-ZIELDATENBANK-WIEDERHERSTELLEN');
  assert.equal((await target.user.findUniqueOrThrow({ where: { id: user.id } })).password, user.password);
  console.log('Linux image: encrypted PostgreSQL 16 backup/restore round trip passed.');
} finally {
  if (target) { await target.$disconnect(); await db.$executeRawUnsafe(`DROP DATABASE "${targetName}"`); }
  if (user) await db.user.delete({ where: { id: user.id } });
  await db.$disconnect(); await rm(temp, { recursive: true, force: true });
}
