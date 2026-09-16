// Operator-side wizard. Only creates a NEW directory; never starts Docker,
// touches existing volumes, or changes an existing installation's secrets.
import { createECDH, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const secret = () => randomBytes(32).toString('hex');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

export function publicOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Bitte eine vollständige HTTPS-Adresse angeben.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !/^[a-z0-9.:[\]-]+$/i.test(url.hostname)) {
    throw new Error('Die Adresse muss eine HTTPS-Domain ohne Pfad, Zugangsdaten oder Parameter sein.');
  }
  return url.origin;
}

export function createConfiguration({ url, port = 3120, version }) {
  const origin = publicOrigin(url);
  if (!/^\d+$/.test(String(port)) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error('Bitte einen freien Port zwischen 1024 und 65535 wählen.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Es ist eine feste veröffentlichte Versionsnummer erforderlich, nicht latest.');
  const vapid = createECDH('prime256v1');
  vapid.generateKeys();
  return {
    COMPOSE_PROJECT_NAME: `mr-${randomBytes(12).toString('hex')}`,
    APP_IMAGE: `ghcr.io/bastimuensch/mobile-reserve-app:${version}`,
    APP_PORT: String(Number(port)),
    NEXT_PUBLIC_APP_URL: origin,
    POSTGRES_USER: 'reserve',
    POSTGRES_DB: 'mobile_reserve',
    POSTGRES_PASSWORD: secret(),
    RECOVERY_DATABASE_PASSWORD: secret(),
    JWT_SECRET: secret(),
    SETUP_TOKEN: secret(),
    SMTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    INVITATION_TOKEN_PEPPER: secret(),
    RECOVERY_AUTH_TOKEN: secret(),
    RECOVERY_CONTROL_TOKEN: secret(),
    RECOVERY_RESCUE_TOKEN: secret(),
    CRON_SECRET: secret(),
    VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString('base64url'),
    VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'),
    VAPID_SUBJECT: origin,
    UPDATE_CHECK_ENABLED: 'true',
  };
}

export async function prepareInstance({ directory, url, port = 3120, version }) {
  const env = createConfiguration({ url, port, version });
  const requested = path.resolve(directory);
  if (requested === path.parse(requested).root) throw new Error('Bitte einen neuen Unterordner wählen.');
  // Canonical parent + atomic non-recursive mkdir: even an empty existing
  // directory or a symlink is refused. No force/overwrite option exists.
  const parent = await realpath(path.dirname(requested));
  const destination = path.join(parent, path.basename(requested));
  const template = await readFile(path.join(root, 'docker-compose.managed.yml'), 'utf8');
  try { await mkdir(destination, { mode: 0o700 }); }
  catch { throw new Error('Ziel konnte nicht neu angelegt werden. Vorhandene Ordner werden niemals überschrieben.'); }
  const command = `docker compose --project-name ${quote(env.COMPOSE_PROJECT_NAME)} --project-directory ${quote(destination)} --env-file ${quote(path.join(destination, '.env'))} -f ${quote(path.join(destination, 'docker-compose.yml'))}`;
  // Exclusive creation, including on partial failures. Never retry by replacing
  // .env: the operator must inspect/retain any partially written new directory.
  await writeFile(path.join(destination, '.env'), Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(destination, 'docker-compose.yml'), template, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(destination, 'ZUGANGSDATEN.txt'), [
    'VERTRAULICH – getrennt und geschützt verwahren, nicht versenden oder veröffentlichen.',
    `Öffentliche Adresse: ${env.NEXT_PUBLIC_APP_URL}`,
    `Einrichtungsschlüssel (erste Einrichtung im Browser): ${env.SETUP_TOKEN}`,
    `Notfallschlüssel (Browser-Wiederherstellung): ${env.RECOVERY_RESCUE_TOKEN}`,
    'Das Schulamt-Konto und dessen Passwort werden erst im Browser angelegt.',
    'Weitere technische Schlüssel stehen in .env. Nicht neu erzeugen oder austauschen.',
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(destination, 'START.md'), `# Neue MobileReserve-Installation\n\nVorbereitet, noch nicht gestartet. Keine bestehenden Daten oder Docker-Volumes wurden geändert.\n\n## 1. Konfiguration prüfen und starten\n\nBei Bedarf vor jeden Docker-Befehl sudo setzen. Keine zusätzlichen -p-Projektnamen verwenden.\n\n\`\`\`sh\n${command} config --quiet\n${command} pull\n${command} up -d\n${command} ps\n\`\`\`\n\n## 2. Erreichbarkeit und Einrichtung\n\nGateway nur lokal: http://127.0.0.1:${env.APP_PORT}. Reverse-Proxy und gültiges TLS für ${env.NEXT_PUBLIC_APP_URL} separat einrichten. Ein Proxy in einem anderen Container kann diesen Host-Loopback nicht automatisch erreichen; sein Netzwerk muss der Betreiber passend einrichten. Datenbank und web haben keine veröffentlichten Ports.\n\nÖffentliche Adresse im Browser öffnen und mit dem Einrichtungsschlüssel aus ZUGANGSDATEN.txt das eigene Schulamt-Konto anlegen. Diese Datei und .env nicht in Tickets/Chats kopieren. DNS, TLS, freie Ports und externe Erreichbarkeit wurden vom Assistenten nicht geprüft.\n\n## 3. Laufenden Container lesend prüfen\n\n\`\`\`sh\n${command} exec -T web node scripts/check-installation.mjs\n\`\`\`\n\nDieser Prüfbefehl ist erst in einem Image mit dem neuen Installationscheck enthalten. Bei älteren Releases steht er noch nicht zur Verfügung. Anschließend im Browser ein verschlüsseltes Vollbackup erstellen und dessen Passwort separat sichern. Ein erfolgreicher Konfigurationscheck ersetzt keinen Wiederherstellungstest.\n\n## Updates und Umzug\n\n.env, Projektname und Schlüssel beibehalten. Den Assistenten nicht erneut über diese Installation ausführen. APP_IMAGE erst nach Prüfung gezielt auf eine neue Release-Version setzen; dann pull/up -d. Vollbackup und Konfiguration verschlüsselt und getrennt vom Server sichern. Zugangsdaten und .env sind auf dem Server nicht verschlüsselt, sondern durch Dateirechte geschützt. Für einen Umzug FULL-BACKUP.md beachten; diese Datei allein ist kein Backup.\n`, { flag: 'wx', mode: 0o600 });
  return { directory: destination, projectName: env.COMPOSE_PROJECT_NAME, image: env.APP_IMAGE, origin: env.NEXT_PUBLIC_APP_URL };
}

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/setup-instance.mjs – interaktiver Assistent nur für NEUE Installationen. Erfordert ein Terminal; startet keine Container.');
    return;
  }
  if (args.length || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Bitte interaktiv im Terminal ohne Argumente starten (oder --help).');
  const { version: defaultVersion } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Neue, getrennte Installation vorbereiten. Bestehende Installationen bleiben unverändert.');
    const directory = (await input.question('Neuer Installationsordner (darf noch nicht existieren): ')).trim();
    if (!directory) throw new Error('Kein Zielordner angegeben.');
    const url = (await input.question('Öffentliche HTTPS-Adresse, z. B. https://uamm.mobilereserve.digital: ')).trim();
    const port = (await input.question('Freier lokaler Gateway-Port [3120]: ')).trim() || '3120';
    const version = (await input.question(`Veröffentlichtes App-Release [${defaultVersion}]: `)).trim() || defaultVersion;
    createConfiguration({ url, port, version });
    if ((await input.question('Neuen Ordner und technische Schlüssel einmalig erzeugen? Zum Bestätigen NEU eingeben: ')).trim() !== 'NEU') {
      console.log('Abgebrochen. Keine Dateien angelegt.'); return;
    }
    const result = await prepareInstance({ directory, url, port, version });
    console.log(`Vorbereitet: ${result.directory}\nNächste Schritte: START.md. Zugangsschlüssel: ZUGANGSDATEN.txt (vertraulich). Noch keine Container gestartet.`);
  } finally { input.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Einrichtung nicht abgeschlossen. Neuen Zielpfad, Schreibrechte und Eingaben prüfen. Eventuell angelegte Dateien bleiben geschützt erhalten; nichts wurde überschrieben.'); process.exitCode = 1; });
}
