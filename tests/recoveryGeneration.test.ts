import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { encryptBackup, sha256 } from '../scripts/full-backup-format.mjs';
import { inspectArchive, validateRecoveryToc } from '../scripts/recovery-generation.mjs';

const secret = randomBytes(24).toString('base64url');
const entry = (value: Buffer) => ({ data: value.toString('base64'), sha256: sha256(value) });
function payload(overrides: Record<string, unknown> = {}) {
  return { format: 'mobile-reserve-full-v1', createdAt: '2026-09-16T12:00:00Z', appVersion: '0.1.6', appCommit: 'commit-a', postgresVersion: '16.14',
    environment: { DATABASE_URL: 'postgresql://source:secret@source/old', JWT_SECRET: 'jwt', SMTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), INVITATION_TOKEN_PEPPER: 'pepper', SETUP_TOKEN: 'never-copy', CRON_SECRET: 'never-copy', NEXT_PUBLIC_APP_URL: 'https://source.invalid' },
    database: entry(Buffer.from('PGDMP-not-a-real-dump')), files: [], ...overrides };
}

test('inspect rejects invalid ids, nonmatching releases and missing required config before creating a generation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'recovery-generation-'));
  try {
    await mkdir(path.join(root, 'generations')); await mkdir(path.join(root, 'migrations'));
    const archive = path.join(root, 'a.mrbackup'); await writeFile(archive, await encryptBackup(payload(), secret));
    await assert.rejects(inspectArchive({ file: archive, password: secret, id: '../bad', dataRoot: root, appVersion: '0.1.6', appCommit: 'commit-a', migrationsDir: path.join(root, 'migrations') }));
    await assert.rejects(inspectArchive({ file: archive, password: secret, id: 'a'.repeat(32), dataRoot: root, appVersion: '0.1.7', appCommit: 'commit-a', migrationsDir: path.join(root, 'migrations') }));
    const missing = path.join(root, 'missing.mrbackup'); await writeFile(missing, await encryptBackup(payload({ environment: { DATABASE_URL: 'postgresql://a:b@c/d' } }), secret));
    await assert.rejects(inspectArchive({ file: missing, password: secret, id: 'b'.repeat(32), dataRoot: root, appVersion: '0.1.6', appCommit: 'commit-a', migrationsDir: path.join(root, 'migrations') }));
    assert.deepEqual(await readdir(path.join(root, 'generations')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('TOC permits ordinary Prisma objects but rejects executable and cross-database objects', () => {
  validateRecoveryToc('1; 2615 2200 SCHEMA - public owner\n2; 1247 2201 TYPE public "Role" owner\n3; 1259 2202 TABLE public "User" owner\n4; 0 0 TABLE DATA public "User" owner\n5; 0 0 COMMENT - SCHEMA public owner\n6; 0 0 FK CONSTRAINT public "User" owner');
  for (const type of ['FUNCTION public dangerous owner', 'TRIGGER public changed owner', 'EXTENSION - plpgsql owner', 'FOREIGN DATA WRAPPER - fdw owner', 'PUBLICATION - publication owner', 'TABLE custom secret owner']) {
    assert.throws(() => validateRecoveryToc(`1; 0 0 ${type}`));
  }
});

test('inspect never writes plaintext before pg_restore validates the dump and never writes outside generations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'recovery-generation-'));
  try {
    await mkdir(path.join(root, 'generations')); const migrations = path.join(root, 'migrations'); await mkdir(migrations);
    const migration = path.join(migrations, '20260101000000_init'); await mkdir(migration); await writeFile(path.join(migration, 'migration.sql'), 'SELECT 1;');
    const archive = path.join(root, 'a.mrbackup'); await writeFile(archive, await encryptBackup(payload(), secret));
    await assert.rejects(inspectArchive({ file: archive, password: secret, id: 'c'.repeat(32), dataRoot: root, appVersion: '0.1.6', appCommit: 'commit-a', migrationsDir: migrations }), /database dump/);
    const names = await readdir(root); assert.ok(!names.includes('database.dump'));
    const generation = path.join(root, 'generations', 'c'.repeat(32));
    assert.equal((await readFile(path.join(generation, 'database.dump'))).subarray(0, 5).toString(), 'PGDMP');
  } finally { await rm(root, { recursive: true, force: true }); }
});
