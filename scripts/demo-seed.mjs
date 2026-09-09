#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat, realpath, readdir, copyFile, unlink, chmod } from 'node:fs/promises';
import { createHash, randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';
import { createDemo, models } from './demo-data.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export async function listUploadFiles(root) {
  const files = [];
  async function visit(current) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Symlinks in Uploads sind nicht erlaubt. Bitte manuell prüfen.');
    if (stat.isDirectory()) {
      for (const name of await readdir(current)) await visit(path.join(current, name));
    } else if (stat.isFile()) files.push({ relative: path.relative(root, current), sha256: digest(await readFile(current)) });
    else throw new Error('Unbekannter Dateityp im Upload-Verzeichnis.');
  }
  try { await lstat(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  await visit(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

export async function replaceDemoData(tx, seed) {
  // Fail closed when new application tables are introduced, not partial reset.
  const actual = Prisma.dmmf.datamodel.models.map(m => m.name[0].toLowerCase() + m.name.slice(1));
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...models].sort())) throw new Error('Datenbankschema geändert; Demo-Script muss geprüft werden.');
  for (const model of ['assignment', 'absence', 'leavePeriod', 'request', 'teacherInvitation', 'passwordResetToken', 'pushSubscription', 'uploadedAsset', 'emailOutbox', 'schulamtProfile', 'teacher']) await tx[model].deleteMany();
  await tx.user.updateMany({ data: { schoolId: null } });
  await tx.school.deleteMany();
  await tx.user.deleteMany();
  await tx.systemSetting.deleteMany();
  await tx.postalCodeGeocode.deleteMany();
  await tx.user.createMany({ data: seed.data.user.map(user => ({ ...user, schoolId: null, sessionVersion: randomInt(1, 2_000_000_000) })) });
  await tx.school.createMany({ data: seed.data.school });
  for (const user of seed.data.user.filter(user => user.schoolId)) await tx.user.update({ where: { id: user.id }, data: { schoolId: user.schoolId } });
  for (const model of ['teacher', 'request', 'assignment', 'absence', 'leavePeriod', 'schulamtProfile', 'systemSetting']) {
    if (seed.data[model].length) await tx[model].createMany({ data: seed.data[model] });
  }
}

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--generate', '--start', '--seed', '--apply', '--backup-dir'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Erlaubt: --generate VERZEICHNIS [--start YYYY-MM-DD] ODER --seed DATEI [--apply BESTÄTIGUNG --backup-dir VERZEICHNIS].');
    if (opts[args[i]]) throw new Error('Doppelte Option.');
    opts[args[i]] = args[i + 1];
  }
  if (opts['--generate']) {
    if (opts['--seed'] || opts['--apply'] || opts['--backup-dir']) throw new Error('Generieren und Ersetzen sind getrennte Aufrufe.');
    const target = path.resolve(opts['--generate']);
    if (target.includes(`${path.sep}public${path.sep}`)) throw new Error('Keine Zugangsdaten im öffentlichen Web-Verzeichnis ablegen.');
    const { seed, credentials } = await createDemo(opts['--start']);
    await mkdir(target, { mode: 0o700 }); // refuses existing output; never overwrites credentials
    await writeFile(path.join(target, 'demo-seed.json'), JSON.stringify(seed, null, 2), { flag: 'wx', mode: 0o600 });
    const labels = { SCHULAMT: 'Schulamt', SCHOOL: 'Schule', TEACHER: 'Mobile Reserve' };
    await writeFile(path.join(target, 'ZUGANGSDATEN.md'), `# Demo-Zugangsdaten – vertraulich\n\nNur für diese Demo. Nicht im Repository oder öffentlich ablegen.\nStartdatum: ${seed.start}; Schuljahr: ${seed.schoolYear}.\n\n| Rolle | Name | Login-E-Mail | Passwort | Hinweis |\n| --- | --- | --- | --- | --- |\n${credentials.map(c => `| ${labels[c.role]} | ${c.name} | ${c.email} | ${c.password} | ${!c.isActive ? 'Warteraum – erst durch Schulamt freischalten' : c.email.startsWith('reserve12@') ? 'Vorjahr – zur Übernahme vorgesehen' : 'Aktiv'} |`).join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`Demo-Datei und separate Zugangsdaten erstellt: ${target}\nKeine Datenbank verändert.`);
    return;
  }
  if (!opts['--seed'] || opts['--start']) throw new Error('Zuerst --generate verwenden, danach --seed DATEI zur Vorschau.');
  const raw = await readFile(opts['--seed']);
  const seed = JSON.parse(raw);
  if (seed.format !== 'mobile-reserve-demo-v1' || models.some(model => !Array.isArray(seed.data?.[model])) || seed.data.systemSetting.find(s => s.id === 'demoMode')?.value !== 'true') throw new Error('Keine gültige Demo-Seeddatei.');
  const connection = new URL(process.env.DATABASE_URL);
  const dbName = decodeURIComponent(connection.pathname.slice(1));
  if (!dbName || !['postgresql:', 'postgres:'].includes(connection.protocol)) throw new Error('Explizite PostgreSQL-Datenbank erforderlich.');
  const identity = `${connection.hostname}:${connection.port || '5432'}/${dbName}`;
  const confirmation = `ERSETZEN:${identity}:${digest(raw).slice(0, 16)}`;
  const poolUrl = new URL(connection);
  poolUrl.searchParams.set('connection_limit', '1');
  const db = new PrismaClient({ datasourceUrl: poolUrl.href });
  try {
    const counts = Object.fromEntries(await Promise.all(models.map(async model => [model, await db[model].count()])));
    console.log(JSON.stringify({ ziel: identity, bestehendeDatensaetze: counts, demo: { start: seed.start, schuljahr: seed.schoolYear, konten: seed.data.user.length, schulen: seed.data.school.length, lehrkraefte: seed.data.teacher.length, anfragen: seed.data.request.length }, bestaetigung: confirmation }, null, 2));
    if (!opts['--apply']) { console.log('Nur Vorschau. Keine Daten verändert.'); return; }
    if (opts['--apply'] !== confirmation || !opts['--backup-dir']) throw new Error('Exakte Bestätigung aus der Vorschau und --backup-dir erforderlich.');
    const active = await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()`;
    if (active.length) throw new Error('Andere Datenbankverbindungen aktiv. Web-App, Worker und weitere Instanzen vorher stoppen.');
    // Only exact runtime upload roots, never the application or home directory.
    const cwd = await realpath(process.cwd());
    const roots = [path.join(cwd, 'public', 'uploads'), path.join(cwd, 'private-uploads')];
    if (process.env.PRIVATE_UPLOADS_DIR && !path.resolve(process.env.PRIVATE_UPLOADS_DIR).startsWith(roots[1] + path.sep)) throw new Error('Abweichendes PRIVATE_UPLOADS_DIR: separat sichern und Pfade fachlich prüfen; automatischer Lauf abgebrochen.');
    for (const root of roots) {
      try { if (await realpath(root) !== root) throw new Error('Upload-Pfad enthält Symlink.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const backup = path.resolve(opts['--backup-dir']);
    const backupParent = await realpath(path.dirname(backup));
    if (backupParent !== path.dirname(backup) || backup === cwd || backup.startsWith(path.join(cwd, 'public') + path.sep) || roots.some(root => backup === root || backup.startsWith(root + path.sep))) throw new Error('Backup muss außerhalb der Upload-/Web-Verzeichnisse liegen, ohne Symlinks.');
    const files = await Promise.all(roots.map(listUploadFiles));
    await mkdir(backup, { mode: 0o700 });
    const dump = path.join(backup, 'database.dump');
    // Credentials are passed only in the environment, never printed/CLI args.
    if (connection.searchParams.get('schema') && connection.searchParams.get('schema') !== 'public') throw new Error('Nur das public-Schema wird unterstützt.');
    const pgEnv = { ...process.env, PGHOST: connection.hostname, PGPORT: connection.port || '5432', PGDATABASE: dbName, PGUSER: decodeURIComponent(connection.username), PGPASSWORD: decodeURIComponent(connection.password), PGSSLMODE: connection.searchParams.get('sslmode') || 'prefer' };
    delete pgEnv.PGSERVICE;
    execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dump], { env: pgEnv, stdio: ['ignore', 'ignore', 'pipe'] });
    await chmod(dump, 0o600);
    execFileSync('pg_restore', ['--list', dump], { stdio: ['ignore', 'ignore', 'pipe'] });
    for (let i = 0; i < roots.length; i++) for (const file of files[i]) {
      const target = path.join(backup, `uploads-${i}`, file.relative);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(path.join(roots[i], file.relative), target);
      await chmod(target, 0o600);
      if (digest(await readFile(target)) !== file.sha256) throw new Error('Backup-Dateiprüfung fehlgeschlagen. Nichts wird ersetzt.');
    }
    await writeFile(path.join(backup, 'manifest.json'), JSON.stringify({ format: 'demo-replacement-recovery-v1', identity, seedSha256: digest(raw), dumpSha256: digest(await readFile(dump)), roots, files }, null, 2), { flag: 'wx', mode: 0o600 });
    await db.$transaction(async tx => {
      const tables = Prisma.dmmf.datamodel.models.map(m => `"${m.name}"`).join(', ');
      // Table identifiers come exclusively from the generated Prisma schema.
      await tx.$executeRawUnsafe(`LOCK TABLE ${tables} IN ACCESS EXCLUSIVE MODE NOWAIT`);
      const others = await tx.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()`;
      if (others.length) throw new Error('Neue Verbindung erkannt. Anwendung vollständig stoppen.');
      for (let i = 0; i < roots.length; i++) if (JSON.stringify(await listUploadFiles(roots[i])) !== JSON.stringify(files[i])) throw new Error('Uploads wurden während der Sicherung verändert.');
      await replaceDemoData(tx, seed);
    }, { timeout: 60_000, maxWait: 5_000 });
    // Filesystem and DB cannot share a transaction. On cleanup failure do NOT
    // restart the app: the complete recovery dump and upload copies remain.
    for (let i = 0; i < roots.length; i++) for (const file of files[i]) await unlink(path.join(roots[i], file.relative));
    await writeFile(path.join(backup, 'ERFOLGREICH.txt'), 'Demodaten eingesetzt, alte Upload-Dateien entfernt. Backup vertraulich aufbewahren.\n', { flag: 'wx', mode: 0o600 });
    console.log(`Demodaten eingesetzt. Alte Daten und Upload-Dateien durch Backup wiederherstellbar: ${backup}\nNur mit einer App-Version starten, die die demoMode-Versandsperre enthält.`);
  } finally { await db.$disconnect(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(`Demo-Lauf abgebrochen: ${error.message}\nWeb-App nicht starten, bis Ursache geklärt ist. Ein vorhandenes Backup unverändert aufbewahren.`);
  process.exitCode = 1;
});
