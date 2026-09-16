// Operator-side wizard. Docker is invoked with argument arrays, never a shell.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
async function docker(args) {
  try { return (await exec('docker', args, { timeout: 300000, maxBuffer: 2 * 1024 * 1024 })).stdout; }
  // Docker errors can echo expanded credentials: never forward their output.
  catch { throw new Error('Docker-Schritt fehlgeschlagen. Docker-Zugriff, freien Port, Speicherplatz und Release-Image prüfen.'); }
}
async function question(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(prompt)).trim(); } finally { rl.close(); }
}

export function validateRestorePort(value) {
  if (!/^\d{4,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error('Bitte einen Port zwischen 1024 und 65535 angeben.');
  return Number(value);
}

// Dependencies are injectable so all safety gates can be tested without Docker.
export async function guidedRestore({ extract, readPassword, ask = question, runDocker = docker, log = console.log, wait = (ms) => delay(ms) }) {
  process.umask(0o077);
  log('Vollbackup wiederherstellen – ausschließlich in einem neuen Docker-Stack.\nVoraussetzungen: Node.js 24, Docker Compose und ein eigener neuer Zielordner.\nDie Datei muss aus einer vertrauenswürdigen eigenen Instanz stammen.');
  await runDocker(['compose', 'version']);
  const endpoint = (await runDocker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).trim();
  if (!endpoint.startsWith('unix://') || (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://'))) throw new Error('Der Assistent benötigt einen lokalen Docker-Dienst (Unix-Socket), keinen entfernten Docker-Host.');
  await runDocker(['info', '--format', '{{.ServerVersion}}']);
  const input = await ask('Pfad zur .mrbackup-Datei: ');
  const output = await ask('Neuer Zielordner (darf noch nicht existieren; übergeordneter Ordner muss existieren): ');
  if (!input || !output) throw new Error('Datei und Zielordner sind erforderlich.');
  // Bind mount source syntax must remain unambiguous on the Linux/macOS host.
  if (/[\x00-\x1f:,]/.test(path.resolve(output))) throw new Error('Zielpfad darf keine Steuerzeichen, Kommas oder Doppelpunkte enthalten.');
  const port = validateRestorePort((await ask('Freier lokaler Port für die neue App [3120]: ')) || '3120');
  const result = await extract(input, await readPassword(), output);
  log(`Sicherung geprüft und entschlüsselt: ${result.directory}\nAchtung: Dieser geschützte Ordner enthält jetzt unverschlüsselte Daten und Geheimnisse.`);
  if (/[\x00-\x1f:,]/.test(result.directory)) throw new Error('Der tatsächliche Zielpfad eignet sich nicht als Docker-Mount. Kein Stack gestartet.');
  if (result.needsManualDeployment) {
    log('Diese Sicherung stammt nicht aus einem stabilen Release. Kein Docker-Stack gestartet. Bitte den Commit aus manifest.json bereitstellen und FULL-BACKUP.md beachten.');
    return { started: false, reason: 'development-build', directory: result.directory };
  }
  const composePath = path.join(result.directory, 'compose.restore.json');
  const compose = JSON.parse(await readFile(composePath, 'utf8'));
  compose.services.web.ports = [`127.0.0.1:${port}:3000`];
  await writeFile(composePath, JSON.stringify(compose, null, 2), { mode: 0o600 });
  const project = `mr-restore-${randomBytes(8).toString('hex')}`;
  const args = ['compose', '--project-name', project, '--project-directory', result.directory, '--env-file', '/dev/null', '-f', composePath];
  // Save the unique project name so later commands address this stack, not a
  // directory-derived project (which would silently allocate another volume).
  const instructions = `Projekt: ${project}\nApp: http://127.0.0.1:${port}\nBefehle im Wiederherstellungsordner ausführen:\ndocker compose --env-file /dev/null -p ${project} -f compose.restore.json ps\ndocker compose --env-file /dev/null -p ${project} -f compose.restore.json stop\n\nKein down -v verwenden: Das würde die wiederhergestellte Datenbank löschen.\nVor Produktivfreigabe alte App stoppen, Domain/Proxy und Scheduler prüfen.\n`;
  const startInstructions = `\nDatenbank und Uploads vollständig wiederhergestellt.\nStart erst nach Prüfung/Isolation:\ndocker compose --env-file /dev/null -p ${project} -f compose.restore.json up -d web\n`;
  const resultPath = path.join(result.directory, 'ASSISTENT-ERGEBNIS.txt');
  await writeFile(resultPath, instructions + '\nWiederherstellung noch NICHT abgeschlossen. Web-App nicht starten.\n', { flag: 'wx', mode: 0o600 });
  log(`Neuer Stack: ${project}\nRelease: ${result.appVersion}\nZugriff nur lokal: http://127.0.0.1:${port}\nEs werden keine vorhandenen Container oder Datenbanken ersetzt.\nDie nächsten Schritte laden ggf. Docker-Images und stellen die neue Datenbank wieder her.`);
  if (await ask('Zum Fortfahren WIEDERHERSTELLEN eingeben (sonst abbrechen): ') !== 'WIEDERHERSTELLEN') {
    log('Abgebrochen. Nur der entschlüsselte Zielordner bleibt erhalten; kein Stack gestartet.');
    return { started: false, reason: 'cancelled', directory: result.directory };
  }
  const label = `label=com.docker.compose.project=${project}`;
  if ((await runDocker(['ps', '-aq', '--filter', label])).trim() || (await runDocker(['volume', 'ls', '-q', '--filter', label])).trim()) throw new Error('Projektname ist bereits belegt. Bestehenden Stack nicht verändert.');
  let created = false;
  try {
    created = true;
    log('Neue Datenbank wird gestartet …');
    await runDocker([...args, 'up', '-d', 'postgres']);
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        // Variables expand only inside the container; no password in argv.
        await runDocker([...args, 'exec', '-T', 'postgres', 'sh', '-c', 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"']); ready = true; break;
      } catch { if (i < 29) await wait(2000); }
    }
    if (!ready) throw new Error('Die neue Datenbank wurde nicht rechtzeitig bereit.');
    log('Leere Zieldatenbank wird geprüft und vollständig wiederhergestellt …');
    await runDocker([...args, 'run', '--rm', '--no-deps', '--user', '0:0', '-v', `${path.join(result.directory, 'database.dump')}:/restore/database.dump:ro`,
      '--entrypoint', 'node', 'web', 'scripts/restore-full-backup.mjs', 'database', '/restore/database.dump', 'LEERE-ZIELDATENBANK-WIEDERHERSTELLEN']);
    // Only our newly extracted upload trees are mounted here. Reject symlinks;
    // never change permissions on an existing host data directory.
    const ownership = `const fs=require('node:fs');function fix(p){const s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory()){for(const n of fs.readdirSync(p))fix(p+'/'+n);}else if(!s.isFile()||s.nlink!==1)throw Error('unsafe file');fs.chownSync(p,1000,1000);fs.chmodSync(p,s.isDirectory()?0o700:0o600);}for(const p of process.argv.slice(1))fix(p);`;
    const roots = ['/app/public/uploads', '/app/private-uploads'];
    if (compose.services.web.environment.PRIVATE_UPLOADS_DIR) roots.push('/app/custom-signatures');
    await runDocker([...args, 'run', '--rm', '--no-deps', '--user', '0:0', '--entrypoint', 'node', 'web', '-e', ownership, ...roots]);
    await writeFile(resultPath, instructions + startInstructions, { mode: 0o600 });
    log('Datenbank und Dateien sind wiederhergestellt. Die Web-App läuft noch nicht.\nScheduler sind abgeschaltet, Benutzeraktionen können aber weiterhin Mail/Push auslösen.\nVor einem Test ausgehenden Versand blockieren. Beim Umzug muss die alte Instanz angehalten sein.');
    if (await ask('Nur nach Isolation/Versandsperre oder für den kontrollierten Umzug STARTEN eingeben (sonst bleibt die App aus): ') !== 'STARTEN') {
      await runDocker([...args, 'stop']);
      log('Wiederherstellung abgeschlossen; der neue Stack bleibt gestoppt. Start-/Statusbefehle stehen in ASSISTENT-ERGEBNIS.txt.');
      return { started: false, reason: 'restored', project, directory: result.directory };
    }
    await runDocker([...args, 'up', '-d', 'web']);
    log(`App-Start angefordert: http://127.0.0.1:${port}\nBitte Logins, PDFs und Einstellungen prüfen. Eine öffentliche Freigabe/DNS-Änderung wurde NICHT vorgenommen.\nStatus- und Stoppbefehle: ${path.join(result.directory, 'ASSISTENT-ERGEBNIS.txt')}`);
    return { started: true, project, directory: result.directory };
  } catch (error) {
    if (created) {
      try { await runDocker([...args, 'stop']); log('Der neue Stack wurde zur Sicherheit gestoppt.'); }
      catch { log('Automatisches Stoppen nicht bestätigt. Den neuen Stack mit dem Stoppbefehl in ASSISTENT-ERGEBNIS.txt prüfen.'); }
    }
    log('Keine Daten/Volumes automatisch gelöscht. Zielordner und gegebenenfalls neue Datenbank bleiben zur Prüfung erhalten.');
    throw error;
  }
}

export function requireInteractiveTerminal() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Der Assistent benötigt ein interaktives Terminal. Für Automatisierung extract/database verwenden.');
}
