import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { encryptBackup, decryptBackup, sha256, validatePayload, validateFilePath } from '../scripts/full-backup-format.mjs';
import { captureEnvironment, BACKUP_ENV_KEYS, collectFiles, pgEnvironment } from '../scripts/full-backup-runtime.mjs';
import { extractBackup, recoveryCompose, restoreDatabase } from '../scripts/restore-full-backup.mjs';

const environment = { DATABASE_URL: 'postgresql://reserve:p%40ss%24word@postgres:5432/mobile_reserve?schema=public', JWT_SECRET: 'jwt-test-only',
  SMTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), INVITATION_TOKEN_PEPPER: 'pepper-test-only', SETUP_TOKEN: 'setup-test', NEXT_PUBLIC_APP_URL: 'https://test.invalid' };
const entry = (data: Buffer) => ({ data: data.toString('base64'), sha256: sha256(data) });
const payload = () => ({ format: 'mobile-reserve-full-v1', createdAt: '2026-09-16T12:00:00Z', appVersion: '0.1.8', appCommit: 'test', postgresVersion: '16.14',
  environment, deploymentCompose: 'services: {}', customSignatures: false,
  database: entry(Buffer.from('PGDMP-test-only')), files: [{ path: 'public-uploads/test.png', ...entry(Buffer.from('image')) }, { path: 'private-uploads/signatures/test.png', ...entry(Buffer.from('signature')) }] });

test('full backup encrypts secrets, round trips, and rejects wrong passwords/tampering', async () => {
  const secret = randomBytes(24).toString('base64url'), source = payload();
  const a = await encryptBackup(source, secret), b = await encryptBackup(source, secret);
  assert.notDeepEqual(a, b);
  assert.equal(a.includes(Buffer.from(environment.JWT_SECRET)), false);
  assert.equal(a.includes(Buffer.from(secret)), false);
  assert.deepEqual(await decryptBackup(a, secret), source);
  await assert.rejects(decryptBackup(a, randomBytes(24).toString('base64url')));
  for (const offset of [0, 10, 28, 45, a.length - 1]) {
    const broken = Buffer.from(a); broken[offset] ^= 1;
    await assert.rejects(decryptBackup(broken, secret));
  }
  await assert.rejects(decryptBackup(a.subarray(0, -1), secret));
  await assert.rejects(encryptBackup(source, 'short'));
});

test('payload validation rejects traversal, corrupt content, duplicates and unknown roots', () => {
  assert.equal(validatePayload(payload()).files.length, 2);
  for (const name of ['../.env', '/etc/passwd', 'public-uploads/../a', 'public-uploads/a\\b', 'public-uploads//x', 'private-uploads/a\nb', 'unknown/file']) assert.throws(() => validateFilePath(name));
  const corrupt = payload(); corrupt.files[0].data = Buffer.from('changed').toString('base64'); assert.throws(() => validatePayload(corrupt));
  const duplicate = payload(); duplicate.files.push(duplicate.files[0]); assert.throws(() => validatePayload(duplicate));
});

test('offline extraction authenticates before writing and never overwrites a directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'full-backup-unit-'));
  try {
    const file = path.join(dir, 'test.mrbackup'), secret = randomBytes(24).toString('base64url');
    await writeFile(file, await encryptBackup(payload(), secret));
    const out = path.join(dir, 'restored');
    await assert.rejects(extractBackup(file, randomBytes(24).toString('base64url'), out));
    assert.deepEqual(await readdir(dir), ['test.mrbackup']);
    const result = await extractBackup(file, secret, out);
    assert.equal(result.files, 2);
    assert.equal(await readFile(path.join(out, 'private-uploads/signatures/test.png'), 'utf8'), 'signature');
    assert.deepEqual(JSON.parse(await readFile(path.join(out, 'environment.original.json'), 'utf8')), environment);
    assert.equal((await stat(path.join(out, 'environment.original.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(out)).mode & 0o777, 0o700);
    const compose = JSON.parse(await readFile(path.join(out, 'compose.restore.json'), 'utf8'));
    assert.equal(compose.services.web.environment.OUTBOX_SCHEDULER, 'off');
    assert.equal(compose.services.postgres.environment.POSTGRES_PASSWORD, 'p@ss$$word');
    await assert.rejects(extractBackup(file, secret, out));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('file collector preserves private files and rejects symlinks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'full-backup-files-'));
  try {
    await mkdir(path.join(dir, 'signatures')); await writeFile(path.join(dir, 'signatures/sig.png'), 'private');
    const files = await collectFiles({ 'private-uploads': dir });
    assert.equal(files[0].path, 'private-uploads/signatures/sig.png');
    await symlink(path.join(dir, 'signatures/sig.png'), path.join(dir, 'link'));
    await assert.rejects(collectFiles({ 'private-uploads': dir }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('configuration is scoped to app settings; database credentials never require argv', async () => {
  const captured = captureEnvironment({ ...environment, UNRELATED_SECRET: 'do-not-copy' });
  assert.equal(captured.UNRELATED_SECRET, undefined);
  assert.throws(() => captureEnvironment({}));
  const pg = pgEnvironment(environment.DATABASE_URL);
  assert.equal(pg.PGPASSWORD, 'p@ss$word'); assert.equal(pg.PGDATABASE, 'mobile_reserve');
  assert.throws(() => pgEnvironment('postgresql://a:b@host/db?unsupported=1'));
  await assert.rejects(restoreDatabase('/unused', environment.DATABASE_URL, 'wrong'));
  const custom = { ...payload(), customSignatures: true, environment: { ...environment, PRIVATE_UPLOADS_DIR: '/old/signatures' } };
  assert.equal(recoveryCompose(custom)!.services.web.environment.PRIVATE_UPLOADS_DIR, '/app/custom-signatures');
  assert.equal(recoveryCompose({ ...payload(), appVersion: '0.1.6-dev.abcdef' }), null);
});

test('all app environment settings remain covered by the full backup contract', async () => {
  // Recovery control-plane secrets are intentionally outside the app backup;
  // generation paths/pause flags are re-derived by the target supervisor.
  const excluded = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'APP_VERSION', 'APP_COMMIT_SHA', 'RECOVERY_AUTH_TOKEN', 'RECOVERY_GENERATION', 'RECOVERY_READ_ONLY', 'NOTIFICATION_SUPPRESSED', 'PUBLIC_UPLOADS_DIR', 'FULL_BACKUP_PRIVATE_ROOT']);
  async function walk(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) await walk(file);
      else if (/\.(ts|tsx)$/.test(e.name)) for (const match of (await readFile(file, 'utf8')).matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
        assert.ok(excluded.has(match[1]) || BACKUP_ENV_KEYS.includes(match[1]), `${file}: ${match[1]} missing from backup`);
      }
    }
  }
  await walk(path.join(process.cwd(), 'src'));
});
