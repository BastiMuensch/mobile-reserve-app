// Bounded recovery-generation preparation. This module deliberately has no
// Docker knowledge: a separately authenticated manager is responsible for
// stopping/starting web processes and for promoting its returned descriptor.
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, statfs, readdir, realpath, stat, cp } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { decryptBackup, validatePayload, MAX_ARCHIVE_BYTES } from './full-backup-format.mjs';
import { restoreDatabase } from './restore-full-backup.mjs';
import { BACKUP_ENV_KEYS } from './full-backup-runtime.mjs';

const exec = promisify(execFile);
const ID = /^[a-f0-9]{32}$/;
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'SMTP_ENCRYPTION_KEY', 'INVITATION_TOKEN_PEPPER'];
const MAX_GENERATION_DATABASE_BYTES = 64 * 1024 * 1024;
const MAX_GENERATION_UPLOAD_BYTES = 64 * 1024 * 1024;
// These are configuration values needed by the app, but never source routing,
// setup, cron, or database credentials. The manager supplies those independently.
const DESCRIPTOR_ENV = BACKUP_ENV_KEYS.filter(key => !['DATABASE_URL', 'SETUP_TOKEN', 'CRON_SECRET', 'NEXT_PUBLIC_APP_URL', 'PRIVATE_UPLOADS_DIR'].includes(key));
const ALLOWED_TOC_TYPES = ['SEQUENCE OWNED BY', 'SEQUENCE SET', 'TABLE DATA', 'FK CONSTRAINT', 'COMMENT', 'SCHEMA', 'TABLE', 'SEQUENCE', 'DEFAULT', 'CONSTRAINT', 'INDEX', 'TYPE'];

function fail(message) { throw new Error(message); }
function requireId(id) { if (typeof id !== 'string' || !ID.test(id)) fail('Invalid recovery generation id'); }
function safeGenerationDir(dataRoot, id) {
  requireId(id);
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) fail('Invalid recovery data root');
  return path.join(dataRoot, 'generations', id);
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function sqlLiteral(value) {
  // Values generated here are hex only; retaining this check makes raw SQL use bounded.
  if (!/^[a-f0-9]+$/.test(value)) fail('Internal recovery identifier error');
  return `'${value}'`;
}
function descriptorEnvironment(environment) {
  return Object.fromEntries(DESCRIPTOR_ENV.filter(key => typeof environment[key] === 'string').map(key => [key, environment[key]]));
}
function validSmtpEncryptionKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  return Buffer.from(value, 'base64').length === 32;
}
async function writeNew(file, content, mode = 0o600) {
  await writeFile(file, content, { flag: 'wx', mode });
}

export function validateRecoveryToc(text) {
  for (const line of text.split('\n')) {
    if (!/^\d+;/.test(line)) continue;
    const rest = line.slice(line.indexOf(';') + 1).trim().replace(/^\d+\s+\d+\s+/, '');
    const type = ALLOWED_TOC_TYPES.find(candidate => rest === candidate || rest.startsWith(`${candidate} `));
    if (!type) fail('Backup contains unsupported database object');
    const remainder = rest.slice(type.length).trim().split(/\s+/);
    // pg_restore list represents `SCHEMA - public`; all application objects are public.
    if (type === 'SCHEMA') {
      if (remainder[0] !== '-' || remainder[1] !== 'public') fail('Backup contains non-public schema');
    } else if (type === 'COMMENT') {
      // A schema comment is emitted as COMMENT - SCHEMA public. Do not permit
      // comments on extensions, functions, or arbitrary object namespaces.
      if (!(remainder[0] === '-' && remainder[1] === 'SCHEMA' && remainder[2] === 'public')) fail('Backup contains unsupported database comment');
    } else if (remainder[0] !== 'public') fail('Backup contains non-public database object');
  }
}

async function validateDumpToc(dump) {
  try {
    const tool = await exec('pg_restore', ['--version'], { timeout: 5000, maxBuffer: 4096 });
    if (!/\(PostgreSQL\) 16\./.test(tool.stdout)) fail('Recovery requires PostgreSQL 16 tools');
    const { stdout } = await exec('pg_restore', ['--list', dump], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    validateRecoveryToc(stdout);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Backup contains')) throw error;
    fail('Backup database dump is unsupported or damaged');
  }
}

async function migrationChecksums(migrationsDir) {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const sql = await readFile(path.join(migrationsDir, entry.name, 'migration.sql'));
    result.push({ migration_name: entry.name, checksum: sha256(sql) });
  }
  if (!result.length) fail('No local migrations available');
  return result;
}

function stagedDatabaseUrl(adminDatabaseUrl, role, password, database) {
  const url = new URL(adminDatabaseUrl);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname) fail('Invalid administrator database URL');
  url.username = role; url.password = password; url.pathname = `/${database}`;
  url.searchParams.set('schema', 'public');
  return url.href;
}
function databaseUrl(adminDatabaseUrl, database) {
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${database}`;
  return url.href;
}

/** Authenticates, validates and writes a new, inactive generation only. */
export async function inspectArchive({ file, password, id, dataRoot, appVersion, appCommit, migrationsDir }) {
  requireId(id);
  if (typeof appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(appVersion)) fail('Recovery requires a stable app release');
  if ((await stat(file)).size > MAX_ARCHIVE_BYTES) fail('Backup archive is too large');
  const payload = await decryptBackup(await readFile(file), password);
  const { database, files } = validatePayload(payload);
  const fileBytes = files.reduce((total, entry) => total + entry.data.length, 0);
  if (database.length > MAX_GENERATION_DATABASE_BYTES || fileBytes > MAX_GENERATION_UPLOAD_BYTES) fail('Backup exceeds recovery generation limits');
  if (payload.appVersion !== appVersion || (appCommit && payload.appCommit !== appCommit)) fail('Backup release does not match this recovery manager');
  if (REQUIRED_ENV.some(key => !payload.environment[key])) fail('Backup lacks required recovery configuration');
  if (!validSmtpEncryptionKey(payload.environment.SMTP_ENCRYPTION_KEY)) fail('Backup has invalid SMTP encryption configuration');
  if (!/^16\./.test(payload.postgresVersion || '')) fail('Backup requires PostgreSQL 16');
  await migrationChecksums(migrationsDir); // local release must be complete before accepting anything.

  const canonicalRoot = await realpath(dataRoot);
  const generationDir = safeGenerationDir(canonicalRoot, id);
  const generationsDir = path.dirname(generationDir);
  if (path.dirname(generationsDir) !== canonicalRoot) fail('Invalid recovery generation path');
  await checkCapacity(canonicalRoot, { databaseBytes: database.length, fileBytes });
  await mkdir(generationDir, { mode: 0o700 });
  try {
    await writeNew(path.join(generationDir, 'database.dump'), database);
    await validateDumpToc(path.join(generationDir, 'database.dump'));
    for (const fileEntry of files) {
      const target = path.join(generationDir, fileEntry.path);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeNew(target, fileEntry.data);
    }
    for (const root of ['public-uploads', 'private-uploads', 'custom-signatures']) await mkdir(path.join(generationDir, root), { recursive: true, mode: 0o700 });
    const descriptor = { generation: id, environment: descriptorEnvironment(payload.environment),
      publicUploadsDir: path.join(generationDir, 'public-uploads'), privateSignaturesDir: payload.customSignatures ? path.join(generationDir, 'custom-signatures') : path.join(generationDir, 'private-uploads', 'signatures'), paused: true, notificationsPaused: true };
    await writeNew(path.join(generationDir, 'environment.json'), JSON.stringify(descriptor.environment));
    await writeNew(path.join(generationDir, 'metadata.json'), JSON.stringify({ createdAt: payload.createdAt, appVersion: payload.appVersion,
      appCommit: payload.appCommit, postgresVersion: payload.postgresVersion, databaseBytes: database.length,
      fileBytes, customSignatures: payload.customSignatures === true }, null, 2));
    return { descriptor, summary: { createdAt: payload.createdAt, appVersion: payload.appVersion }, generationDir };
  } finally { database.fill(0); for (const entry of files) entry.data.fill(0); }
}

async function checkCapacity(dataRoot, metadata) {
  const fs = await statfs(dataRoot);
  const available = Number(fs.bavail) * Number(fs.bsize);
  const required = 1024 * 1024 * 1024 + 4 * (metadata.databaseBytes + metadata.fileBytes);
  if (!Number.isSafeInteger(available) || available < required) fail('Insufficient recovery storage capacity');
}

async function verifyMigrations(client, migrationsDir) {
  const expected = await migrationChecksums(migrationsDir);
  const actual = await client.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name');
  if (!Array.isArray(actual) || actual.length !== expected.length) fail('Restored migrations do not match this release');
  for (let index = 0; index < expected.length; index++) {
    const row = actual[index];
    if (row.migration_name !== expected[index].migration_name || row.checksum !== expected[index].checksum || !row.finished_at || row.rolled_back_at) fail('Restored migrations do not match this release');
  }
}

async function invalidateRestoredSessions(client) {
  const existing = new Set((await client.user.findMany({ select: { sessionVersion: true } })).map(user => user.sessionVersion));
  let sessionVersion;
  do { sessionVersion = 1 + (randomBytes(4).readUInt32BE(0) % 2147483647); } while (existing.has(sessionVersion));
  await client.user.updateMany({ data: { sessionVersion } });
  return sessionVersion;
}

/** Creates and restores an isolated per-generation database. The caller must already have stopped the old web process. */
export async function restoreGeneration({ id, dataRoot, outputDataRoot, adminDatabaseUrl, migrationsDir }) {
  requireId(id);
  const generationDir = safeGenerationDir(dataRoot, id);
  const metadata = JSON.parse(await readFile(path.join(generationDir, 'metadata.json'), 'utf8'));
  if (!Number.isSafeInteger(metadata.databaseBytes) || !Number.isSafeInteger(metadata.fileBytes)) fail('Invalid recovery metadata');
  await checkCapacity(dataRoot, metadata);
  const role = `mr_web_${id}`, database = `mr_restore_${id}`, password = randomBytes(32).toString('hex');
  // Written before server-side mutation so an interrupted operator run remains inspectable.
  await writeNew(path.join(generationDir, 'restore-marker.json'), JSON.stringify({ role, database, password, state: 'prepared' }));
  const admin = new PrismaClient({ datasources: { db: { url: adminDatabaseUrl } } });
  let target, stageAdmin;
  try {
    const version = await admin.$queryRawUnsafe("SELECT current_setting('server_version_num') AS version");
    if (!Array.isArray(version) || !/^16\d{4}$/.test(String(version[0]?.version))) fail('Recovery requires PostgreSQL 16');
    await admin.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD ${sqlLiteral(password)}`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${database} OWNER ${role} TEMPLATE template0`);
    await admin.$executeRawUnsafe(`REVOKE CONNECT, TEMPORARY ON DATABASE ${database} FROM PUBLIC`);
    // The old owner retains explicit/owner access; removing PUBLIC prevents the new role crossing into baseline DBs.
    const original = new URL(adminDatabaseUrl); const baseline = original.pathname.slice(1);
    if (/^[A-Za-z0-9_]+$/.test(baseline) && baseline !== database) await admin.$executeRawUnsafe(`REVOKE CONNECT, TEMPORARY ON DATABASE ${baseline} FROM PUBLIC`);
    await admin.$executeRawUnsafe(`GRANT CONNECT, TEMPORARY ON DATABASE ${database} TO ${role}`);
    stageAdmin = new PrismaClient({ datasources: { db: { url: databaseUrl(adminDatabaseUrl, database) } } });
    await stageAdmin.$executeRawUnsafe('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await stageAdmin.$executeRawUnsafe(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);
    await stageAdmin.$disconnect(); stageAdmin = undefined;
    const targetUrl = stagedDatabaseUrl(adminDatabaseUrl, role, password, database);
    await restoreDatabase(path.join(generationDir, 'database.dump'), targetUrl, 'LEERE-ZIELDATENBANK-WIEDERHERSTELLEN');
    target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
    await verifyMigrations(target, migrationsDir);
    const rows = await target.user.groupBy({ by: ['role', 'isActive'], _count: { _all: true } });
    const schulamt = rows.find(row => row.role === 'SCHULAMT' && row.isActive)?. _count._all || 0;
    if (!schulamt) fail('Restored generation has no active Schulamt account');
    await invalidateRestoredSessions(target);
    const saved = JSON.parse(await readFile(path.join(generationDir, 'environment.json'), 'utf8'));
    const outputRoot = await realpath(outputDataRoot || dataRoot);
    const stagingRoot = await realpath(dataRoot);
    const outputGenerationDir = safeGenerationDir(outputRoot, id);
    if (outputRoot !== stagingRoot) {
      await mkdir(path.dirname(outputGenerationDir), { recursive: true, mode: 0o700 });
      // `cp` is only reached after dump, migration, and account verification.
      // The source is manager-only staging; neither metadata nor credentials are copied.
      await mkdir(outputGenerationDir, { mode: 0o700 });
      for (const root of ['public-uploads', 'private-uploads', 'custom-signatures']) {
        await cp(path.join(generationDir, root), path.join(outputGenerationDir, root), { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
      }
    }
    const descriptor = { generation: id, environment: { ...saved, DATABASE_URL: targetUrl },
      publicUploadsDir: path.join(outputGenerationDir, 'public-uploads'), privateSignaturesDir: metadata.customSignatures ? path.join(outputGenerationDir, 'custom-signatures') : path.join(outputGenerationDir, 'private-uploads', 'signatures'), paused: true, notificationsPaused: true };
    await writeNew(path.join(generationDir, 'descriptor.json'), JSON.stringify(descriptor));
    await writeFile(path.join(generationDir, 'restore-marker.json'), JSON.stringify({ role, database, password, state: 'restored' }), { mode: 0o600 });
    const [users, schools, teachers, requests, assignments] = await Promise.all([target.user.count(), target.school.count(), target.teacher.count(), target.request.count(), target.assignment.count()]);
    return { descriptor, counts: { users, schools, teachers, requests, assignments } };
  } catch {
    throw new Error('Recovery generation restore failed; the baseline generation was not deleted');
  } finally {
    await target?.$disconnect();
    await stageAdmin?.$disconnect();
    await admin.$disconnect();
  }
}
