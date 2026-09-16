import { constants } from 'node:fs';
import { lstat, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256, validateFilePath } from './full-backup-format.mjs';

const exec = promisify(execFile);
const MAX_BYTES = 64 * 1024 * 1024;
export const BACKUP_ENV_KEYS = [
  'DATABASE_URL', 'JWT_SECRET', 'SETUP_TOKEN', 'SMTP_ENCRYPTION_KEY', 'SMTP_ENCRYPTION_KEY_PREVIOUS',
  'INVITATION_TOKEN_PEPPER', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT',
  'NEXT_PUBLIC_APP_URL', 'GEOCODING_BASE_URL', 'GEOCODING_USER_AGENT', 'CRON_SECRET',
  'GDPR_CLEANUP_SCHEDULER', 'OUTBOX_SCHEDULER', 'UPDATE_CHECK_ENABLED', 'DEMO_MODE',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE', 'PRIVATE_UPLOADS_DIR',
];

/** @param {Record<string,string|undefined>} [env]
 * @returns {Record<string,string>} */
export function captureEnvironment(env = process.env) {
  const result = Object.fromEntries(BACKUP_ENV_KEYS.filter(k => typeof env[k] === 'string').map(k => [k, env[k]]));
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'SMTP_ENCRYPTION_KEY', 'INVITATION_TOKEN_PEPPER']) {
    if (!result[key]) throw new Error('Missing required backup configuration');
  }
  // Never silently omit future app settings: the list is covered by a source-scan test.
  return result;
}

export function pgEnvironment(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('PostgreSQL required');
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: '10' };
  // Prisma's schema/connection_limit parameters are not understood by libpq.
  const parameters = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY' };
  for (const [name, value] of url.searchParams) {
    if (parameters[name]) env[parameters[name]] = value;
    else if (!['schema', 'connection_limit', 'pool_timeout', 'connect_timeout', 'pgbouncer'].includes(name)) throw new Error('Unsupported database connection option');
  }
  return env;
}

export async function collectFiles(roots) {
  const files = [];
  let bytes = 0;
  async function walk(root, dir, relative = '') {
    if ((await lstat(dir)).isSymbolicLink()) throw new Error('Symlink in uploads');
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const child = path.join(dir, entry.name), rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Symlink in uploads');
      if (entry.isDirectory()) { await walk(root, child, rel); continue; }
      if (!entry.isFile()) throw new Error('Unsupported upload file');
      const name = `${root}/${rel}`;
      validateFilePath(name);
      const handle = await open(child, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (stat.nlink > 1) throw new Error('Hardlink in uploads');
        bytes += stat.size;
        if (bytes > MAX_BYTES || files.length >= 10000) throw new Error('Uploads exceed backup limit');
        const data = await handle.readFile();
        if (data.length !== stat.size) throw new Error('Upload changed while reading');
        files.push({ path: name, data: data.toString('base64'), sha256: sha256(data) });
      } finally { await handle.close(); }
    }
  }
  for (const [root, dir] of Object.entries(roots)) {
    const stat = await lstat(dir).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) continue; // An unused, empty upload root need not exist yet.
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid upload root');
    await walk(root, dir);
  }
  return files.sort((a,b) => a.path.localeCompare(b.path));
}

/** @param {{databaseUrl: string, snapshot: string, environment: Record<string,string>, roots: Record<string,string>, requiredFiles?: string[], appVersion: string, appCommit: string, postgresVersion: string, deploymentCompose: string}} options */
export async function createFullBackup({ databaseUrl, snapshot, environment, roots, requiredFiles = [], appVersion, appCommit, postgresVersion, deploymentCompose }) {
  if (!/^[0-9A-Fa-f-]+$/.test(snapshot)) throw new Error('Invalid database snapshot');
  const client = await exec('pg_dump', ['--version'], { timeout: 5000 });
  if (!/^16\./.test(postgresVersion) || !/\(PostgreSQL\) 16\./.test(client.stdout)) throw new Error('Backup requires matching PostgreSQL 16 tools');
  const files = await collectFiles(roots);
  const names = new Set(files.map(f => f.path));
  if (requiredFiles.some(f => !names.has(f))) throw new Error('Referenced upload missing');
  // Credentials never enter argv, stderr or a plaintext temporary dump file.
  let result;
  try {
    result = await exec('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--snapshot', snapshot], { env: pgEnvironment(databaseUrl), encoding: 'buffer', maxBuffer: MAX_BYTES, timeout: 120000 });
  } catch { throw new Error('PostgreSQL backup failed'); }
  if (!result.stdout.subarray(0, 5).equals(Buffer.from('PGDMP'))) throw new Error('Invalid PostgreSQL dump');
  const after = await collectFiles(roots);
  if (JSON.stringify(files.map(f => [f.path, f.sha256])) !== JSON.stringify(after.map(f => [f.path, f.sha256]))) throw new Error('Uploads changed during backup; retry');
  return {
    format: 'mobile-reserve-full-v1', createdAt: new Date().toISOString(),
    appVersion, appCommit, postgresVersion, environment, deploymentCompose, customSignatures: 'custom-signatures' in roots,
    database: { data: result.stdout.toString('base64'), sha256: sha256(result.stdout) }, files,
  };
}
