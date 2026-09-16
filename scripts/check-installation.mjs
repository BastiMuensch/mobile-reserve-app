// Read-only installation diagnostics. This script neither creates backups nor
// changes application, database, filesystem, or Docker state.
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { RecoverySupervisor } from './recovery-supervisor.mjs';

const exec = promisify(nodeExecFile);
const WEB_RECOVERY_TOKENS = ['RECOVERY_AUTH_TOKEN', 'RECOVERY_CONTROL_TOKEN'];
const RESCUE_TOKEN = 'RECOVERY_RESCUE_TOKEN';

function present(value) { return typeof value === 'string' && value.trim().length > 0; }

function validDatabaseUrl(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname) && url.pathname.length > 1;
  } catch { return false; }
}

function validSmtpKey(value) {
  if (!present(value) || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  return Buffer.from(value, 'base64').length === 32;
}

function validPublicOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
  } catch { return false; }
}

/**
 * Pure configuration check suitable for installers and unit tests.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: boolean, issues: string[], managedRecovery: 'absent' | 'valid' | 'invalid' }}
 */
export function inspectEnvironment(env) {
  const issues = [];
  if (!validDatabaseUrl(env.DATABASE_URL)) issues.push('DATABASE_URL ist nicht als PostgreSQL-Verbindungs-URL gesetzt.');
  for (const key of ['JWT_SECRET', 'INVITATION_TOKEN_PEPPER', 'SETUP_TOKEN']) {
    if (!present(env[key]) || env[key].length < 32) issues.push(`${key} muss mindestens 32 Zeichen haben.`);
  }
  if (!validSmtpKey(env.SMTP_ENCRYPTION_KEY)) issues.push('SMTP_ENCRYPTION_KEY ist kein Base64-Schlüssel mit genau 32 Byte.');
  if (!validPublicOrigin(env.NEXT_PUBLIC_APP_URL)) issues.push('NEXT_PUBLIC_APP_URL muss eine HTTPS-Origin ohne Pfad, Zugangsdaten, Query oder Fragment sein.');

  const configuredRecoveryTokens = [...WEB_RECOVERY_TOKENS, RESCUE_TOKEN].filter(key => present(env[key]));
  let managedRecovery = 'absent';
  if (configuredRecoveryTokens.length) {
    managedRecovery = 'valid';
    if (WEB_RECOVERY_TOKENS.some(key => present(env[key]))) for (const key of WEB_RECOVERY_TOKENS) if (!present(env[key]) || env[key].length < 32) issues.push(`${key} muss im Managed-Webprozess mindestens 32 Zeichen haben.`);
    if (present(env[RESCUE_TOKEN]) && env[RESCUE_TOKEN].length < 32) issues.push(`${RESCUE_TOKEN} muss mindestens 32 Zeichen haben.`);
    if (new Set(configuredRecoveryTokens.map(key => env[key])).size !== configuredRecoveryTokens.length) issues.push('Vorhandene Wiederherstellungsschlüssel müssen voneinander verschieden sein.');
    if (issues.some(issue => issue.startsWith('RECOVERY_') || issue.startsWith('Vorhandene Wiederherstellungsschlüssel'))) managedRecovery = 'invalid';
  }
  return { ok: issues.length === 0, issues, managedRecovery };
}

/**
 * Resolves the environment actually used by the managed web child. Importing
 * RecoverySupervisor is safe: it only starts a process from its guarded main.
 * @param {{ env?: Record<string, string | undefined>, readFile?: (path: string, encoding: string) => Promise<string> }} [options]
 */
export async function resolveCheckEnvironment(options = {}) {
  const env = options.env || process.env;
  const managed = WEB_RECOVERY_TOKENS.some(key => present(env[key])) || present(env.RECOVERY_RUNTIME_DIR);
  if (!managed) return { ok: true, env, generation: 'classic', recoveryStatus: 'classic', issues: [] };
  try {
    const supervisor = new RecoverySupervisor({ env, readFile: options.readFile });
    const descriptor = await supervisor.readDescriptor();
    const effective = supervisor.childEnvironment(descriptor);
    // childEnvironment deliberately strips control-plane values. The web check
    // still validates the two tokens that legitimately belong to this service.
    for (const key of WEB_RECOVERY_TOKENS) if (present(env[key])) effective[key] = env[key];
    const paused = descriptor.paused === true;
    return { ok: !paused, env: effective, generation: descriptor.generation, recoveryStatus: paused ? 'paused' : 'active',
      issues: paused ? ['Die aktive Wiederherstellungsgeneration ist noch schreibgeschützt pausiert.'] : [] };
  } catch {
    return { ok: false, generation: 'unknown', recoveryStatus: 'invalid', issues: ['Aktiver Wiederherstellungsdescriptor ist ungültig oder nicht lesbar.'] };
  }
}

function clientMajor(stdout) { return /\(PostgreSQL\) 16\./.test(String(stdout)); }
function databaseMajor(rows) {
  const value = Array.isArray(rows) ? rows[0]?.server_version_num : undefined;
  return /^16\d{4}$/.test(String(value));
}

/**
 * Performs only explicit database/tool reads. `PrismaClientClass` and `runExec`
 * are injectable to keep tests fully isolated from real services.
 * @param {{ env?: Record<string, string | undefined>, PrismaClientClass?: typeof PrismaClient, runExec?: (file: string, args: string[], options: object) => Promise<{ stdout: string }>, readFile?: (path: string, encoding: string) => Promise<string> }} [options]
 */
export async function runInstallationCheck(options = {}) {
  const resolved = await resolveCheckEnvironment({ env: options.env || process.env, readFile: options.readFile });
  if (!resolved.ok && resolved.recoveryStatus === 'invalid') {
    return { ok: false, configuration: inspectEnvironment(options.env || process.env), generation: resolved.generation, recoveryStatus: resolved.recoveryStatus, recoveryIssues: resolved.issues, checks: [] };
  }
  const env = resolved.env;
  const PrismaClientClass = options.PrismaClientClass || PrismaClient;
  const runExec = options.runExec || exec;
  const configuration = inspectEnvironment(env);
  const checks = [];
  try {
    const [dump, restore] = await Promise.all([
      runExec('pg_dump', ['--version'], { timeout: 5000, maxBuffer: 4096 }),
      runExec('pg_restore', ['--version'], { timeout: 5000, maxBuffer: 4096 }),
    ]);
    checks.push({ name: 'pg_dump PostgreSQL 16', ok: clientMajor(dump.stdout) });
    checks.push({ name: 'pg_restore PostgreSQL 16', ok: clientMajor(restore.stdout) });
  } catch {
    checks.push({ name: 'PostgreSQL-Clientwerkzeuge', ok: false });
  }

  let database;
  if (!validDatabaseUrl(env.DATABASE_URL)) {
    checks.push({ name: 'PostgreSQL-Leseprüfung', ok: false });
  } else try {
    database = new PrismaClientClass({ datasources: { db: { url: env.DATABASE_URL } } });
    await database.$queryRawUnsafe('SELECT 1');
    const version = await database.$queryRawUnsafe('SHOW server_version_num');
    checks.push({ name: 'PostgreSQL-Verbindung und Server 16', ok: databaseMajor(version) });
    const now = new Date();
    const [smtpProfiles, encryptedSystemSettings, encryptedOutbox, activeInvitations] = await Promise.all([
      database.schulamtProfile.count({ where: { smtpPass: { startsWith: 'enc:' } } }),
      database.systemSetting.count({ where: { id: 'smtpPass', value: { startsWith: 'enc:' } } }),
      database.emailOutbox.count({ where: { payloadEncrypted: { not: null } } }),
      database.teacherInvitation.count({ where: { revokedAt: null, completedAt: null, expiresAt: { gt: now } } }),
    ]);
    checks.push({ name: 'Lesbare Bestandszählungen', ok: true, counts: { smtpProfiles, encryptedSystemSettings, encryptedOutbox, activeInvitations } });
  } catch {
    checks.push({ name: 'PostgreSQL-Leseprüfung', ok: false });
  } finally {
    await database?.$disconnect().catch(() => {});
  }
  return { ok: resolved.ok && configuration.ok && checks.every(check => check.ok), configuration, generation: resolved.generation, recoveryStatus: resolved.recoveryStatus, recoveryIssues: resolved.issues, checks };
}

export async function main() {
  const result = await runInstallationCheck();
  if (!result.configuration.ok) for (const issue of result.configuration.issues) console.error(`Konfiguration: ${issue}`);
  for (const issue of result.recoveryIssues) console.error(`Wiederherstellung: ${issue}`);
  if (result.generation) console.log(`Generation: ${result.generation} (${result.recoveryStatus})`);
  for (const check of result.checks) {
    console.log(`${check.ok ? 'OK' : 'FEHLER'}: ${check.name}`);
    if (check.counts) console.log(`Bestand (nur Zählwerte): SMTP-Profile ${check.counts.smtpProfiles}, Systemwerte ${check.counts.encryptedSystemSettings}, Outbox ${check.counts.encryptedOutbox}, aktive Einladungen ${check.counts.activeInvitations}`);
  }
  if (!result.ok) {
    console.error('Installationscheck nicht bestanden. Es wurden keine Daten verändert; dies ist keine Zusage vollständiger Wiederherstellbarkeit.');
    process.exitCode = 1;
  } else console.log('Installationscheck bestanden. Dies bestätigt keine vollständige Wiederherstellbarkeit.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Installationscheck konnte nicht abgeschlossen werden. Es wurden keine Daten verändert.');
  process.exitCode = 1;
});
