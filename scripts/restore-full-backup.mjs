#!/usr/bin/env node
// Offline recovery: authenticates the archive before writing any plaintext.
import { readFile, writeFile, mkdir, stat, realpath, chmod } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decryptBackup, validatePayload, MAX_ARCHIVE_BYTES } from './full-backup-format.mjs';
import { pgEnvironment } from './full-backup-runtime.mjs';

const exec = promisify(execFile);
const escapeCompose = value => value.replaceAll('$', () => '$$');

export function recoveryCompose(payload) {
  const original = new URL(payload.environment.DATABASE_URL);
  const major = /^([0-9]+)\./.exec(payload.postgresVersion)?.[1];
  if (major !== '16') throw new Error('This recovery template requires PostgreSQL 16; operator migration needed');
  // Branch builds have no immutable semver image tag. Extraction still works;
  // the operator must build/select the recorded commit instead of pulling :main.
  if (!/^\d+\.\d+\.\d+$/.test(payload.appVersion)) return null;
  const database = decodeURIComponent(original.pathname.slice(1));
  const user = decodeURIComponent(original.username), password = decodeURIComponent(original.password);
  if (!database || !user || !password) throw new Error('Database credentials incomplete');
  const url = new URL(original); url.hostname = 'postgres'; url.port = '5432';
  // Local isolated Docker database uses no external TLS configuration.
  url.search = '';
  const environment = { ...payload.environment, DATABASE_URL: url.href, NODE_ENV: 'production',
    GDPR_CLEANUP_SCHEDULER: 'off', OUTBOX_SCHEDULER: 'off', UPDATE_CHECK_ENABLED: 'false' };
  const custom = payload.customSignatures === true;
  if (custom) environment.PRIVATE_UPLOADS_DIR = '/app/custom-signatures';
  else delete environment.PRIVATE_UPLOADS_DIR;
  const mounts = ['./public-uploads:/app/public/uploads', './private-uploads:/app/private-uploads'];
  if (custom) mounts.push('./custom-signatures:/app/custom-signatures');
  return { services: {
    postgres: { image: `postgres:${major}-alpine`, restart: 'unless-stopped',
      environment: Object.fromEntries(Object.entries({ POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database }).map(([k,v]) => [k, escapeCompose(v)])),
      volumes: ['postgres-data:/var/lib/postgresql/data'] },
    web: { image: `ghcr.io/bastimuensch/mobile-reserve-app:${payload.appVersion}`, restart: 'unless-stopped',
      environment: Object.fromEntries(Object.entries(environment).map(([k,v]) => [k, escapeCompose(v)])),
      ports: ['127.0.0.1:3000:3000'], depends_on: ['postgres'], volumes: mounts },
  }, volumes: { 'postgres-data': {} } };
}

export async function extractBackup(file, password, output) {
  if ((await stat(file)).size > MAX_ARCHIVE_BYTES) throw new Error('Archive too large');
  const payload = await decryptBackup(await readFile(file), password);
  const { database, files } = validatePayload(payload);
  const compose = recoveryCompose(payload);
  // Canonicalize the selected existing parent (macOS /tmp itself is a symlink).
  // The final directory must be new; mkdir rejects existing directories/symlinks.
  const selected = path.resolve(output);
  const destination = path.join(await realpath(path.dirname(selected)), path.basename(selected));
  await mkdir(destination, { mode: 0o700 });
  async function write(relative, data) {
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data, { flag: 'wx', mode: 0o600 });
  }
  await write('database.dump', database);
  for (const file of files) await write(file.path, file.data);
  for (const dir of ['public-uploads', 'private-uploads', 'custom-signatures']) await mkdir(path.join(destination, dir), { recursive: true, mode: 0o700 });
  await write('environment.original.json', JSON.stringify(payload.environment, null, 2));
  if (compose) await write('compose.restore.json', JSON.stringify(compose, null, 2));
  await write('compose.reference.yml', typeof payload.deploymentCompose === 'string' ? payload.deploymentCompose : '');
  await write('manifest.json', JSON.stringify({ format: payload.format, createdAt: payload.createdAt, appVersion: payload.appVersion,
    appCommit: payload.appCommit, postgresVersion: payload.postgresVersion, databaseSha256: payload.database.sha256,
    files: payload.files.map(f => ({ path: f.path, sha256: f.sha256 })) }, null, 2));
  await write('WIEDERHERSTELLUNG.txt', 'VERTRAULICH: Dieses Verzeichnis enthält entschlüsselte Zugangsdaten und personenbezogene Daten. Nicht veröffentlichen.\nNur eine leere, isolierte Zielinstanz verwenden. App erst nach Datenbank-Restore starten.\ncompose.restore.json ist ein neuer, portabler Startvorschlag; keine Kopie einer individuellen Host-Konfiguration.\nHintergrundjobs sind für die Prüfung abgeschaltet. Vor Freigabe Scheduler, Domain, Proxy und Versand prüfen.\nQuell-App vor abschließendem Umzugsbackup stoppen bzw. Zugriffe sperren; nicht beide Instanzen produktiv betreiben.\nUpload-Verzeichnisse müssen dem App-Benutzer (im Image UID/GID 1000) zugänglich sein.\n');
  await chmod(destination, 0o700);
  return { directory: destination, files: files.length, appVersion: payload.appVersion, needsManualDeployment: !compose };
}

export async function restoreDatabase(dump, databaseUrl, confirmation) {
  if (confirmation !== 'LEERE-ZIELDATENBANK-WIEDERHERSTELLEN') throw new Error('Explicit restore confirmation required');
  const env = pgEnvironment(databaseUrl);
  try {
    const result = await exec('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')"], { env, timeout: 15000 });
    if (result.stdout.trim() !== '0') throw new Error('Target is not empty');
    // No --clean: never replace a populated installation. Single transaction rolls back errors.
    await exec('pg_restore', ['--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', '--dbname', env.PGDATABASE, dump], { env, timeout: 180000, maxBuffer: 1024 * 1024 });
  } catch { throw new Error('Restore refused or failed. Target must be empty and reachable; no existing tables are deleted.'); }
}

async function readPassword() {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) { value += chunk; if (value.length > 128) throw new Error('Invalid password input'); }
    return value.trim();
  }
  process.stderr.write('Backup-Passwort (Eingabe verborgen): ');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', receive); process.stderr.write('\n'); };
    const receive = chunk => {
      for (const c of chunk) {
        if (c === '\u0003') { cleanup(); reject(new Error('Aborted')); return; }
        if (c === '\r' || c === '\n') { cleanup(); resolve(value); return; }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (value.length < 128) value += c;
      }
    };
    process.stdin.on('data', receive);
  });
}

async function main() {
  process.umask(0o077);
  const [mode, input, output] = process.argv.slice(2);
  if (mode === 'guided' && process.argv.length === 3) {
    const { guidedRestore, requireInteractiveTerminal } = await import('./guided-full-backup.mjs');
    requireInteractiveTerminal();
    await guidedRestore({ extract: extractBackup, readPassword });
  } else if (mode === 'extract' && input && output && process.argv.length === 5) {
    const result = await extractBackup(input, await readPassword(), output);
    console.log(`Backup authentifiziert und entschlüsselt. ${result.files} Dateien, App-Version ${result.appVersion}. Vertrauliches Zielverzeichnis: ${result.directory}`);
    if (result.needsManualDeployment) console.log('Kein stabiles Release-Image im Backup: Deployment anhand des aufgezeichneten Commits vorbereiten. Keine automatische Compose-Datei erzeugt.');
  } else if (mode === 'database' && input && output && process.env.DATABASE_URL && process.argv.length === 5) {
    await restoreDatabase(input, process.env.DATABASE_URL, output); console.log('Datenbank vollständig wiederhergestellt.');
  } else { throw new Error('Aufruf: node scripts/restore-full-backup.mjs guided | extract DATEI.mrbackup NEUES_VERZEICHNIS | database database.dump LEERE-ZIELDATENBANK-WIEDERHERSTELLEN (DATABASE_URL der leeren Zielinstanz erforderlich)'); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Wiederherstellung fehlgeschlagen.'); process.exitCode = 1; });
}
