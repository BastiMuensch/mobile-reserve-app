import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { encryptBackup, sha256 } from '../scripts/full-backup-format.mjs';
import { inspectArchive, validateRecoveryToc, trustedAssignmentGuardSql } from '../scripts/recovery-generation.mjs';

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

test('TOC strips only exact locally managed function signatures and table/trigger pairs', () => {
  const executable = [
    'FUNCTION public assignment_booking_slots(text, integer) owner',
    'FUNCTION public enforce_assignment_day_booking() owner',
    'FUNCTION public recheck_request_day_bookings() owner',
    'TRIGGER public Assignment Assignment_check_day_booking owner',
    'TRIGGER public Request Request_recheck_day_bookings owner',
  ];
  const table = '10; 1259 2202 TABLE public Assignment owner';
  const result = validateRecoveryToc([...executable.map((entry, index) => `${index + 1}; 0 0 ${entry}`), table].join('\n'));
  assert.deepEqual(result.split('\n').filter(line => /^\d+;/.test(line)), [table], 'archive executable definitions never enter the restore list');
  for (const entry of [
    'FUNCTION public assignment_booking_slots(text) owner',
    'FUNCTION custom assignment_booking_slots(text, integer) owner',
    'FUNCTION public enforce_assignment_day_booking_extra() owner',
    'TRIGGER public User Assignment_check_day_booking owner',
    'TRIGGER public Assignment malicious owner',
    'FUNCTION public enforce_assignment_day_booking() owner extra',
  ]) assert.throws(() => validateRecoveryToc(`1; 0 0 ${entry}`), /unsupported/);
});

test('guard restore SQL comes from the local migration, preserves triggers and validates restored rows', async () => {
  const migration = await readFile(path.join(process.cwd(), 'prisma/migrations/20261105120000_same_site_assignment_blocks/migration.sql'), 'utf8');
  const sql = trustedAssignmentGuardSql(migration);
  assert.equal((sql.match(/CREATE FUNCTION/g) ?? []).length, 3);
  assert.equal((sql.match(/CREATE TRIGGER/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /DROP INDEX|CREATE UNIQUE INDEX/);
  assert.match(sql, /^BEGIN;\nSET LOCAL search_path = public, pg_catalog;/);
  assert.match(sql, /UPDATE "Assignment" SET "status" = "status" WHERE "status" NOT IN/);
  assert.match(sql, /COMMIT;\n$/);
  assert.throws(() => trustedAssignmentGuardSql('SELECT 1;'), /unsupported/);
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
