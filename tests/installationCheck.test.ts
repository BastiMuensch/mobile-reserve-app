import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { inspectEnvironment, resolveCheckEnvironment, runInstallationCheck } from '../scripts/check-installation.mjs';

const environment = () => ({
  DATABASE_URL: 'postgresql://reserve:secret@postgres:5432/mobile_reserve',
  JWT_SECRET: 'j'.repeat(32),
  SMTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  INVITATION_TOKEN_PEPPER: 'i'.repeat(32),
  SETUP_TOKEN: 's'.repeat(32),
  NEXT_PUBLIC_APP_URL: 'https://mobile.example.invalid',
});

test('inspectEnvironment accepts the required classic configuration without recovery tokens', () => {
  assert.deepEqual(inspectEnvironment(environment()), { ok: true, issues: [], managedRecovery: 'absent' });
});

test('inspectEnvironment reports invalid required values without returning their contents', () => {
  const secret = 'do-not-display-this-secret';
  const result = inspectEnvironment({ ...environment(), DATABASE_URL: 'not a url', SMTP_ENCRYPTION_KEY: 'short', NEXT_PUBLIC_APP_URL: 'http://user:pass@example.invalid/path?q=1', JWT_SECRET: secret, SETUP_TOKEN: '' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.startsWith('DATABASE_URL')));
  assert.ok(result.issues.some(issue => issue.startsWith('SMTP_ENCRYPTION_KEY')));
  assert.ok(result.issues.some(issue => issue.startsWith('NEXT_PUBLIC_APP_URL')));
  assert.ok(result.issues.some(issue => issue.startsWith('SETUP_TOKEN')));
  assert.equal(result.issues.join(' ').includes(secret), false);
});

test('inspectEnvironment validates web recovery tokens without requiring gateway-only rescue access', () => {
  const token = (suffix: string) => `${suffix}${'x'.repeat(32)}`;
  assert.deepEqual(inspectEnvironment({ ...environment(), RECOVERY_AUTH_TOKEN: token('a'), RECOVERY_CONTROL_TOKEN: token('b') }), { ok: true, issues: [], managedRecovery: 'valid' });
  const invalid = inspectEnvironment({ ...environment(), RECOVERY_AUTH_TOKEN: token('a'), RECOVERY_CONTROL_TOKEN: token('a') });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.managedRecovery, 'invalid');
  assert.ok(invalid.issues.some(issue => issue.startsWith('Vorhandene Wiederherstellungsschlüssel')));
  const rescue = inspectEnvironment({ ...environment(), RECOVERY_RESCUE_TOKEN: 'short' });
  assert.equal(rescue.managedRecovery, 'invalid');
  assert.ok(rescue.issues.some(issue => issue.startsWith('RECOVERY_RESCUE_TOKEN')));
});

test('runInstallationCheck uses only mocked tool and read-client calls', async () => {
  const calls: string[] = [];
  class MockPrisma {
    schulamtProfile = { count: async () => 2 };
    systemSetting = { count: async () => 1 };
    emailOutbox = { count: async () => 3 };
    teacherInvitation = { count: async () => 4 };
    async $queryRawUnsafe(query: string) { calls.push(query); return query === 'SHOW server_version_num' ? [{ server_version_num: '160002' }] : [{ '?column?': 1 }]; }
    async $disconnect() { calls.push('disconnect'); }
  }
  const result = await runInstallationCheck({ env: environment(), PrismaClientClass: MockPrisma as never, runExec: async () => ({ stdout: 'pg_dump (PostgreSQL) 16.2' }) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.at(-1)?.counts, { smtpProfiles: 2, encryptedSystemSettings: 1, encryptedOutbox: 3, activeInvitations: 4 });
  assert.deepEqual(calls, ['SELECT 1', 'SHOW server_version_num', 'disconnect']);
});

test('runInstallationCheck still reads database counts when non-database secrets are missing', async () => {
  const incomplete = { ...environment(), SMTP_ENCRYPTION_KEY: '', JWT_SECRET: '' };
  let counted = 0;
  class MockPrisma {
    schulamtProfile = { count: async () => ++counted };
    systemSetting = { count: async () => ++counted };
    emailOutbox = { count: async () => ++counted };
    teacherInvitation = { count: async () => ++counted };
    async $queryRawUnsafe(query: string) { return query === 'SHOW server_version_num' ? [{ server_version_num: '160000' }] : [{}]; }
    async $disconnect() {}
  }
  const result = await runInstallationCheck({ env: incomplete, PrismaClientClass: MockPrisma as never, runExec: async () => ({ stdout: 'PostgreSQL 16.1' }) });
  assert.equal(result.ok, false);
  assert.equal(counted, 4);
  assert.equal(result.checks.at(-1)?.ok, true);
});

test('runInstallationCheck redacts tool/database errors and rejects non-16 majors', async () => {
  class BrokenPrisma {
    async $queryRawUnsafe() { throw new Error('postgresql://user:private-password@db/hidden'); }
    async $disconnect() {}
  }
  const result = await runInstallationCheck({ env: environment(), PrismaClientClass: BrokenPrisma as never, runExec: async () => ({ stdout: 'pg_dump (PostgreSQL) 15.8' }) });
  assert.equal(result.ok, false);
  assert.equal(result.checks.some(check => check.ok), false);
  assert.equal(JSON.stringify(result).includes('private-password'), false);
});

test('managed check derives the active descriptor database instead of the supervisor baseline', async () => {
  const id = 'a'.repeat(32), activeDatabase = 'postgresql://restored:secret@postgres:5432/mr_restore_active';
  const env = { ...environment(), DATABASE_URL: 'postgresql://baseline:secret@postgres:5432/mobile_reserve', RECOVERY_AUTH_TOKEN: 'a'.repeat(32), RECOVERY_CONTROL_TOKEN: 'b'.repeat(32), RECOVERY_RUNTIME_DIR: '/runtime' };
  const descriptor = { generation: id, environment: { DATABASE_URL: activeDatabase, JWT_SECRET: 'r'.repeat(32), SMTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), INVITATION_TOKEN_PEPPER: 'p'.repeat(32) }, paused: false, notificationsPaused: true };
  const resolved = await resolveCheckEnvironment({ env, readFile: async () => JSON.stringify(descriptor) });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.generation, id);
  assert.equal(resolved.env?.DATABASE_URL, activeDatabase);
  assert.equal(resolved.env?.RECOVERY_RESCUE_TOKEN, undefined);

  let databaseUrl = '';
  class MockPrisma {
    constructor(options: { datasources: { db: { url: string } } }) { databaseUrl = options.datasources.db.url; }
    schulamtProfile = { count: async () => 0 }; systemSetting = { count: async () => 0 }; emailOutbox = { count: async () => 0 }; teacherInvitation = { count: async () => 0 };
    async $queryRawUnsafe(query: string) { return query === 'SHOW server_version_num' ? [{ server_version_num: '160000' }] : [{}]; }
    async $disconnect() {}
  }
  const result = await runInstallationCheck({ env, readFile: async () => JSON.stringify(descriptor), PrismaClientClass: MockPrisma as never, runExec: async () => ({ stdout: 'pg_dump (PostgreSQL) 16.1' }) });
  assert.equal(result.ok, true);
  assert.equal(result.generation, id);
  assert.equal(databaseUrl, activeDatabase);
});

test('invalid managed descriptor fails closed before tool or database reads', async () => {
  const env = { ...environment(), RECOVERY_AUTH_TOKEN: 'a'.repeat(32), RECOVERY_CONTROL_TOKEN: 'b'.repeat(32), RECOVERY_RUNTIME_DIR: '/runtime' };
  let executed = false, queried = false;
  class MockPrisma { async $queryRawUnsafe() { queried = true; return []; } async $disconnect() {} }
  const result = await runInstallationCheck({ env, readFile: async () => '{bad json', PrismaClientClass: MockPrisma as never, runExec: async () => { executed = true; return { stdout: 'pg_dump (PostgreSQL) 16.1' }; } });
  assert.equal(result.ok, false);
  assert.equal(result.recoveryStatus, 'invalid');
  assert.equal(executed, false);
  assert.equal(queried, false);
});

test('paused descriptor reports its generation without claiming readiness', async () => {
  const env = { ...environment(), RECOVERY_AUTH_TOKEN: 'a'.repeat(32), RECOVERY_CONTROL_TOKEN: 'b'.repeat(32), RECOVERY_RUNTIME_DIR: '/runtime' };
  const descriptor = { generation: 'b'.repeat(32), environment: {}, paused: true, notificationsPaused: true };
  const resolved = await resolveCheckEnvironment({ env, readFile: async () => JSON.stringify(descriptor) });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.recoveryStatus, 'paused');
  assert.equal(resolved.generation, descriptor.generation);
});
