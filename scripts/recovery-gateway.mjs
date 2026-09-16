import { createServer, request as httpRequest } from 'node:http';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, statfs, access } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RecoveryCoordinator, secretEquals, SESSION_MS, waitForReadiness } from './recovery-coordinator.mjs';
import { inspectArchive, restoreGeneration } from './recovery-generation.mjs';
import { MAX_ARCHIVE_BYTES } from './full-backup-format.mjs';
import { recoveryHtml, recoveryJs } from './recovery-ui.mjs';

const PREFIX = '/_recovery';
const COOKIE = 'mr_recovery_session';
const CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP };
function cookieToken(request) {
  return (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}
function reply(response, status, value, extra = {}) {
  response.writeHead(status, { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8', ...extra });
  response.end(JSON.stringify(value));
}
async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Ungültiges Anfrageformat.');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length; if (size > 4096) throw new Error('Anfrage zu groß.');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Anfrage.');
  return value;
}
function credentials(body) {
  const keys = ['password', 'setupToken', 'rescueToken'].filter(k => typeof body[k] === 'string' && body[k].length > 0 && body[k].length <= 256);
  if (keys.length !== 1) throw new Error('Bitte genau einen Anmeldenachweis angeben.');
  return { mode: keys[0], body: { [keys[0]]: body[keys[0]] } };
}

export function gatewayConfiguration(env = process.env) {
  const origin = new URL(env.NEXT_PUBLIC_APP_URL || '');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('HTTPS-App-Adresse erforderlich.');
  for (const key of ['RECOVERY_CONTROL_TOKEN', 'RECOVERY_AUTH_TOKEN', 'RECOVERY_RESCUE_TOKEN']) {
    if (typeof env[key] !== 'string' || env[key].length < 32) throw new Error(`${key} muss unabhängig eingerichtet werden.`);
  }
  if (new Set([env.RECOVERY_CONTROL_TOKEN, env.RECOVERY_AUTH_TOKEN, env.RECOVERY_RESCUE_TOKEN]).size !== 3) throw new Error('Wiederherstellungsschlüssel müssen verschieden sein.');
  const web = new URL(env.RECOVERY_WEB_URL || 'http://web:3000');
  const control = new URL(env.RECOVERY_CONTROL_URL || 'http://web:3101');
  if (web.protocol !== 'http:' || control.protocol !== 'http:' || web.username || control.username) throw new Error('Ungültiger interner Dienst.');
  return { origin: origin.origin, secure: origin.protocol === 'https:', web, control,
    stateDir: env.RECOVERY_STATE_DIR || '/app/recovery-state', dataRoot: env.RECOVERY_DATA_DIR || '/app/recovery-data',
    runtimeDir: env.RECOVERY_RUNTIME_DIR || '/app/recovery-runtime', adminDatabaseUrl: env.RECOVERY_DATABASE_URL,
    appVersion: env.APP_VERSION, appCommit: env.APP_COMMIT_SHA, migrationsDir: path.join(process.cwd(), 'prisma/migrations'),
    controlToken: env.RECOVERY_CONTROL_TOKEN, authToken: env.RECOVERY_AUTH_TOKEN, rescueToken: env.RECOVERY_RESCUE_TOKEN,
  };
}

export async function makeCoordinator(config) {
  await mkdir(path.join(config.dataRoot, 'generations'), { recursive: true, mode: 0o700 });
  const stagingRoot = path.join(config.stateDir, 'staging');
  await mkdir(path.join(stagingRoot, 'generations'), { recursive: true, mode: 0o700 });
  const control = async operation => {
    const response = await fetch(new URL(`/${operation}`, config.control), { method: 'POST', headers: { 'x-recovery-control-token': config.controlToken }, signal: AbortSignal.timeout(35000) });
    if (!response.ok) throw new Error('Anwendungsprozess konnte nicht kontrolliert umgeschaltet werden.');
    const value = await response.json();
    if (operation === 'stop' && value.running !== false) throw new Error('Anwendungsprozess wurde nicht vollständig gestoppt.');
  };
  const ready = generation => waitForReadiness(async () => {
    const response = await fetch(new URL('/api/backup/recovery/readiness', config.web), { headers: { 'x-recovery-auth-token': config.authToken }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const body = await response.json();
    return body.ready === true && body.generation === generation && (generation === 'baseline' || body.offices > 0);
  });
  return new RecoveryCoordinator({ stateDir: config.stateDir, runtimeDir: config.runtimeDir, dataRoot: config.dataRoot,
    control, ready,
    inspect: options => inspectArchive({ ...options, dataRoot: stagingRoot, appVersion: config.appVersion, appCommit: config.appCommit, migrationsDir: config.migrationsDir }),
    restore: options => restoreGeneration({ ...options, dataRoot: stagingRoot, outputDataRoot: config.dataRoot, adminDatabaseUrl: config.adminDatabaseUrl, migrationsDir: config.migrationsDir }),
  });
}

export function createGateway({ config, coordinator, authorize: customAuthorize, initialization = Promise.resolve() }) {
  let initialized = false;
  initialization.then(() => { initialized = true; }).catch(() => { /* status portal remains available; normal traffic remains closed. */ });
  const setCookie = token => `${COOKIE}=${token}; Path=/_recovery; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_MS / 1000 : 0}${config.secure ? '; Secure' : ''}`;
  async function authorize(request, body) {
    const credential = credentials(body);
    await coordinator.loginAttempt();
    if (customAuthorize) return await customAuthorize(request, credential) ? credential.mode : null;
    if (credential.mode === 'rescueToken') return secretEquals(credential.body.rescueToken, config.rescueToken) ? credential.mode : null;
    const response = await fetch(new URL('/api/backup/recovery/authorize', config.web), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-recovery-auth-token': config.authToken, cookie: request.headers.cookie || '' },
      body: JSON.stringify(credential.body), signal: AbortSignal.timeout(15000),
    });
    return response.ok && (await response.json()).authorized === true ? credential.mode : null;
  }
  const server = createServer(async (request, response) => {
    response.on('error', () => {});
    let url;
    try {
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) throw new Error('Invalid request target');
      url = new URL(request.url, config.origin);
      if (url.origin !== config.origin) throw new Error('Invalid request target');
    } catch { return reply(response, 400, { error: 'Ungültiger Anfragepfad.' }); }
    const pathname = url.pathname;
    if (pathname === PREFIX || pathname.startsWith(`${PREFIX}/`)) {
      try {
        if (request.method === 'GET' && [PREFIX, `${PREFIX}/`].includes(pathname)) {
          response.writeHead(200, { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' }); response.end(recoveryHtml()); return;
        }
        if (request.method === 'GET' && pathname === `${PREFIX}/app.js`) {
          response.writeHead(200, { ...NO_STORE, 'Content-Type': 'application/javascript; charset=utf-8' }); response.end(recoveryJs); return;
        }
        if (request.method === 'GET' && pathname === `${PREFIX}/logo.png`) {
          const packaged = path.join(process.cwd(), 'scripts/recovery-logo.png');
          const fallback = path.join(process.cwd(), 'src/app/icon.png');
          const logo = await access(packaged).then(() => packaged).catch(() => fallback);
          response.writeHead(200, { ...NO_STORE, 'Content-Type': 'image/png' });
          createReadStream(logo).on('error', () => response.destroy()).pipe(response); return;
        }
        if (request.method === 'GET' && pathname === `${PREFIX}/api/capabilities`) return reply(response, 200, { available: true });
        const session = coordinator.session(cookieToken(request));
        if (request.method === 'GET' && pathname === `${PREFIX}/api/session`) return reply(response, 200, { authenticated: Boolean(session), authMode: session?.mode });
        if (request.method === 'POST') {
          if (request.headers.origin !== config.origin || request.headers['sec-fetch-site'] === 'cross-site') return reply(response, 403, { error: 'Anfragequelle nicht erlaubt.' });
          if (pathname === `${PREFIX}/api/login`) {
            const mode = await authorize(request, await jsonBody(request));
            if (!mode) return reply(response, 403, { error: 'Anmeldung nicht bestätigt. Zuerst in der App als Schulamt anmelden oder den passenden Einrichtungsschlüssel verwenden.' });
            return reply(response, 200, { ok: true, authMode: mode }, { 'Set-Cookie': setCookie(await coordinator.createSession(mode)) });
          }
        }
        if (!session) return reply(response, 401, { error: 'Anmeldung erforderlich.' });
        if (request.method === 'GET' && pathname === `${PREFIX}/api/status`) return reply(response, 200, { ...coordinator.publicStatus(), ...(initialized ? {} : { phase: 'failed', maintenance: true, error: 'Wiederherstellungsdienst wartet auf eine Betreiberprüfung.' }) });
        if (request.method !== 'POST') return reply(response, 405, { error: 'Methode nicht erlaubt.' });
        if (pathname === `${PREFIX}/api/logout`) { await coordinator.logout(cookieToken(request)); return reply(response, 200, { ok: true }, { 'Set-Cookie': setCookie('') }); }
        if (!initialized) return reply(response, 503, { error: 'Wiederherstellungsdienst wird noch geprüft.' });
        if (pathname === `${PREFIX}/api/upload`) {
          if (request.headers['content-type'] !== 'application/octet-stream') return reply(response, 400, { error: 'Backupdatei erforderlich.' });
          const free = await statfs(config.stateDir);
          if (Number(free.bavail) * Number(free.bsize) < MAX_ARCHIVE_BYTES * 2) return reply(response, 507, { error: 'Nicht genügend freier Sicherungsspeicher.' });
          const file = await coordinator.beginUpload();
          let size = 0, ok = false;
          try {
            const bounded = new Transform({ transform(chunk, _, callback) { size += chunk.length; callback(size > MAX_ARCHIVE_BYTES ? new Error('Archive too large') : null, chunk); } });
            await pipeline(request, bounded, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
            if (size < 53) throw new Error('Archive too short');
            ok = true;
          } finally { await coordinator.finishUpload(ok); }
          return reply(response, 200, { ok: true });
        }
        const body = await jsonBody(request);
        if (pathname === `${PREFIX}/api/prepare`) {
          if (typeof body.backupPassword !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(body.backupPassword)) return reply(response, 400, { error: 'Ungültiges Backup-Passwort.' });
          coordinator.prepare(body.backupPassword); coordinator.background.catch(() => {});
          return reply(response, 202, { ok: true });
        }
        if (pathname === `${PREFIX}/api/cancel`) { await coordinator.cancel(); return reply(response, 200, { ok: true }); }
        if (pathname === `${PREFIX}/api/commit` || pathname === `${PREFIX}/api/resume`) {
          const isCommit = pathname.endsWith('/commit');
          if (isCommit && body.confirmation !== 'WIEDERHERSTELLEN') return reply(response, 400, { error: 'Bestätigung erforderlich.' });
          if (!isCommit && body.reviewedOutbox !== true) return reply(response, 400, { error: 'Bitte den Mailausgang vor der Freigabe prüfen.' });
          if (!await authorize(request, body)) return reply(response, 403, { error: 'Bitte die aktuelle Berechtigung erneut bestätigen.' });
          if (isCommit) coordinator.commit(); else coordinator.resume();
          coordinator.background.catch(() => {});
          return reply(response, 202, { ok: true });
        }
        return reply(response, 404, { error: 'Nicht gefunden.' });
      } catch {
        if (!response.headersSent && !response.destroyed) reply(response, 400, { error: 'Aktion nicht möglich. Status prüfen; Datei, Passwort oder Speicherplatz kontrollieren.' });
        return;
      }
    }
    // No browser can inject our internal authorization headers or reach the
    // supervisor/authorization endpoints through this public proxy.
    if (pathname.startsWith('/api/backup/recovery/')) return reply(response, 403, { error: 'Interner Dienst.' });
    if (!initialized || !coordinator.canServe()) {
      response.writeHead(503, { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5' });
      response.end('<!doctype html><html lang="de"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wartung</title><h1>Wiederherstellung läuft</h1><p>Bitte warten. Änderungen sind vorübergehend gesperrt.</p><a href="/_recovery/">Geschützten Wiederherstellungsstatus öffnen</a></html>'); return;
    }
    if (pathname.startsWith('/uploads/')) {
      const name = pathname.slice('/uploads/'.length);
      if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/i.test(name)) return reply(response, 404, { error: 'Nicht gefunden.' });
      const media = httpRequest(new URL(`/api/backup/recovery/public-media/${encodeURIComponent(name)}`, config.web), {
        method: 'GET', headers: { 'x-recovery-auth-token': config.authToken },
      }, internal => {
        if (internal.statusCode !== 200) { internal.resume(); return reply(response, 404, { error: 'Nicht gefunden.' }); }
        response.writeHead(200, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg' });
        internal.pipe(response);
      });
      media.on('error', () => { if (!response.headersSent) reply(response, 404, { error: 'Nicht gefunden.' }); else response.destroy(); });
      media.end(); return;
    }
    const headers = { ...request.headers };
    for (const key of Object.keys(headers)) if (key.startsWith('x-recovery-')) delete headers[key];
    headers['x-forwarded-proto'] = config.secure ? 'https' : 'http';
    const upstream = httpRequest(new URL(request.url || '/', config.web), { method: request.method, headers }, remote => {
      response.writeHead(remote.statusCode || 502, remote.headers); remote.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) reply(response, 502, { error: 'Anwendung vorübergehend nicht erreichbar.' }); else response.destroy(); });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.requestTimeout = 180000;
  server.headersTimeout = 15000;
  return server;
}

export async function main() {
  process.umask(0o077);
  const config = gatewayConfiguration();
  const coordinator = await makeCoordinator(config);
  const initialization = (async () => {
    await waitForReadiness(async () => {
      const response = await fetch(new URL('/status', config.control), { headers: { 'x-recovery-control-token': config.controlToken }, signal: AbortSignal.timeout(2000) });
      return response.ok;
    });
    await coordinator.initialize();
  })();
  const server = createGateway({ config, coordinator, initialization });
  server.listen(3000, '0.0.0.0');
  initialization.catch(() => console.error('[recovery] Initialisierung nicht abgeschlossen; öffentliche App gesperrt.'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(() => { console.error('[recovery] Start fehlgeschlagen. Konfiguration prüfen.'); process.exitCode = 1; });
