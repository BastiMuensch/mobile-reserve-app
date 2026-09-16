import { mkdir, readFile, open, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const SESSION_MS = 60 * 60 * 1000;
const ACTIVE_PHASES = new Set(['preparing', 'committing', 'verifying']);
const BASELINE = { generation: 'baseline', environment: {}, paused: false, notificationsPaused: false };
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export function secretEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || b.length < 32) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function atomicJson(filename, data) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, filename);
  const directory = await open(path.dirname(filename), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function optionalJson(filename, fallback) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('Wiederherstellungszustand beschädigt. Betreiberprüfung erforderlich.'); }
}

/** Durable control plane, intentionally independent of the application DB/JWT. */
export class RecoveryCoordinator {
  constructor({ stateDir, runtimeDir, dataRoot, inspect, restore, control, ready, now = Date.now }) {
    this.stateDir = stateDir; this.runtimeDir = runtimeDir; this.dataRoot = dataRoot;
    this.inspect = inspect; this.restore = restore; this.control = control; this.ready = ready; this.now = now;
    this.state = { phase: 'idle', maintenance: true, sessions: [], attempts: [] };
    this.busy = false;
    this.background = null;
    this.persistence = Promise.resolve();
  }
  async save() {
    const snapshot = JSON.parse(JSON.stringify(this.state));
    const write = this.persistence.then(() => atomicJson(path.join(this.stateDir, 'state.json'), snapshot));
    this.persistence = write.catch(() => {});
    await write;
  }
  canServe() { return !this.state.maintenance && !(this.busy && ['completed', 'rolled_back'].includes(this.state.phase)); }
  async active() { return optionalJson(path.join(this.runtimeDir, 'active.json'), BASELINE); }
  async activate(descriptor) { await atomicJson(path.join(this.runtimeDir, 'active.json'), descriptor); }
  async initialize() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    this.state = await optionalJson(path.join(this.stateDir, 'state.json'), this.state);
    if (!Array.isArray(this.state.sessions) || !Array.isArray(this.state.attempts) || typeof this.state.phase !== 'string') throw new Error('Ungültiger Wiederherstellungszustand.');
    // Gateway keeps its independent initialization barrier closed throughout.
    if (['committing', 'verifying'].includes(this.state.phase)) {
      await this.rollback('Der unterbrochene Wechsel wurde auf den bisherigen Stand zurückgesetzt.');
    } else {
      if (this.state.phase === 'preparing') {
        this.state.phase = 'failed'; this.state.error = 'Die Vorbereitung wurde unterbrochen. Bitte die Sicherung erneut auswählen.';
      }
      if (!this.state.maintenance || this.state.phase === 'idle') {
        const active = await this.active();
        await this.control('start');
        await this.ready(active.generation);
        this.state.maintenance = false;
      }
      await this.save();
    }
  }
  publicStatus() {
    const { phase, jobId, summary, error, notificationsPaused, maintenance } = this.state;
    const safeSummary = summary ? {
      createdAt: typeof summary.createdAt === 'string' && Number.isFinite(Date.parse(summary.createdAt)) ? summary.createdAt : undefined,
      appVersion: typeof summary.appVersion === 'string' && /^\d+\.\d+\.\d+$/.test(summary.appVersion) ? summary.appVersion : undefined,
      counts: Object.fromEntries(['users', 'schools', 'teachers', 'requests', 'assignments'].filter(key => Number.isSafeInteger(summary.counts?.[key]) && summary.counts[key] >= 0).map(key => [key, summary.counts[key]])),
    } : undefined;
    return { phase, jobId, summary: safeSummary, error, notificationsPaused: notificationsPaused === true, maintenance: maintenance === true };
  }
  session(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.state.sessions.find(s => s.hash === hashToken(token) && s.expires > this.now()) || null;
  }
  async loginAttempt() {
    this.state.attempts = this.state.attempts.filter(t => t > this.now() - 15 * 60 * 1000);
    if (this.state.attempts.length >= 10) throw new Error('Zu viele Anmeldeversuche. Bitte 15 Minuten warten.');
    this.state.attempts.push(this.now()); await this.save();
  }
  async createSession(mode) {
    const token = randomBytes(32).toString('hex');
    this.state.sessions = this.state.sessions.filter(s => s.expires > this.now()).slice(-19);
    this.state.sessions.push({ hash: hashToken(token), expires: this.now() + SESSION_MS, mode });
    await this.save(); return token;
  }
  async logout(token) { this.state.sessions = this.state.sessions.filter(s => s.hash !== hashToken(token || '')); await this.save(); }
  assertMutable() {
    if (this.busy || ACTIVE_PHASES.has(this.state.phase) || this.state.maintenance) throw new Error('Eine Wiederherstellung läuft bereits oder die Instanz benötigt eine Betreiberprüfung.');
  }
  async beginUpload() {
    this.assertMutable();
    if (this.state.phase === 'ready' || this.state.phase === 'uploaded') throw new Error('Bitte die vorbereitete Sicherung zuerst abbrechen.');
    this.busy = true;
    try {
      const history = path.join(this.stateDir, 'history'); await mkdir(history, { recursive: true, mode: 0o700 });
      if ((await readdir(history)).length >= 10) throw new Error('Zehn Wiederherstellungen sind aufbewahrt. Der Betreiber muss den Sicherungsspeicher prüfen und bereinigen.');
      if (this.state.jobId) await atomicJson(path.join(history, `${this.state.jobId}.json`), { ...this.state, sessions: [], attempts: [] });
      const jobId = randomBytes(16).toString('hex');
      this.state = { phase: 'uploaded', jobId, maintenance: false, sessions: this.state.sessions, attempts: this.state.attempts };
      await mkdir(path.join(this.stateDir, 'archives'), { recursive: true, mode: 0o700 });
      await this.save();
      return path.join(this.stateDir, 'archives', `${jobId}.mrbackup`);
    } catch (e) { this.busy = false; throw e; }
  }
  async finishUpload(ok) {
    if (!ok) { this.state.phase = 'failed'; this.state.error = 'Die Datei konnte nicht vollständig hochgeladen werden. Bitte erneut versuchen.'; }
    this.busy = false; await this.save();
  }
  prepare(password) {
    this.assertMutable();
    if (this.state.phase !== 'uploaded') throw new Error('Bitte zuerst eine Sicherung hochladen.');
    this.busy = true;
    this.state.phase = 'preparing'; this.state.error = undefined;
    this.background = this.performPrepare(password);
  }
  async performPrepare(password) {
    try {
      await this.save();
      const result = await this.inspect({ file: path.join(this.stateDir, 'archives', `${this.state.jobId}.mrbackup`), password, id: this.state.jobId, dataRoot: this.dataRoot });
      this.state.summary = result.summary;
      this.state.phase = 'ready';
    } catch {
      this.state.phase = 'failed';
      this.state.error = 'Sicherung nicht freigegeben: Passwort, Dateiintegrität, Versionsverträglichkeit oder freier Speicher prüfen. Der bisherige Stand bleibt unverändert.';
    } finally { this.busy = false; await this.save(); }
  }
  async cancel() {
    this.assertMutable();
    if (!['uploaded', 'ready'].includes(this.state.phase)) throw new Error('Kein vorbereiteter Auftrag.');
    this.state.phase = 'idle'; this.state.error = undefined;
    await this.save();
  }
  commit() {
    this.assertMutable();
    if (this.state.phase !== 'ready') throw new Error('Die Sicherung ist noch nicht zur Wiederherstellung freigegeben.');
    this.busy = true; this.state.maintenance = true;
    this.background = this.performCommit();
  }
  async performCommit() {
    try {
      this.state.previous = await this.active();
      this.state.phase = 'committing';
      await this.save(); // Journal before the first stop/switch side effect.
      await this.control('stop');
      const result = await this.restore({ id: this.state.jobId, dataRoot: this.dataRoot });
      this.state.summary = { ...this.state.summary, counts: result.counts };
      const staged = { ...result.descriptor, paused: true, notificationsPaused: true };
      await this.activate(staged);
      this.state.phase = 'verifying'; await this.save();
      await this.control('start'); await this.ready(staged.generation);
      await this.control('stop');
      await this.activate({ ...staged, paused: false });
      await this.control('start'); await this.ready(staged.generation);
      this.state.phase = 'completed'; this.state.notificationsPaused = true; this.state.error = undefined;
      // Durable completion BEFORE the public gate opens. On restart both DB and
      // files resolve through the same descriptor and the notification barrier.
      this.state.maintenance = false; await this.save();
    } catch { await this.rollback('Wiederherstellung nicht abgeschlossen. Der bisherige Stand wurde wieder aktiviert.'); }
    finally { this.busy = false; }
  }
  async rollback(message) {
    this.state.maintenance = true;
    try {
      if (!this.state.previous) throw new Error('Missing rollback generation');
      await this.control('stop'); await this.activate(this.state.previous);
      await this.control('start'); await this.ready(this.state.previous.generation);
      this.state.phase = 'rolled_back'; this.state.maintenance = false;
      this.state.notificationsPaused = this.state.previous.notificationsPaused === true;
      this.state.error = message;
    } catch {
      this.state.phase = 'failed'; this.state.maintenance = true;
      this.state.error = 'Die Instanz bleibt sicher im Wartungsmodus. Der Betreiber muss den Wiederherstellungszustand prüfen. Es wurden keine bisherigen Daten gelöscht.';
    }
    try { await this.save(); } catch (error) { this.state.maintenance = true; throw error; }
  }
  resume() {
    this.assertMutable();
    if (!['completed', 'rolled_back'].includes(this.state.phase) || !this.state.notificationsPaused) throw new Error('Keine pausierten Benachrichtigungen.');
    this.busy = true; this.state.maintenance = true;
    this.background = this.performResume();
  }
  async performResume() {
    try {
      this.state.previous = await this.active(); this.state.phase = 'verifying'; await this.save();
      await this.control('stop');
      await this.activate({ ...this.state.previous, notificationsPaused: false });
      await this.control('start'); await this.ready(this.state.previous.generation);
      this.state.phase = 'completed'; this.state.notificationsPaused = false; this.state.maintenance = false;
      await this.save();
    } catch { await this.rollback('Freigabe fehlgeschlagen. Der wiederhergestellte Stand bleibt mit pausierten Benachrichtigungen erhalten.'); }
    finally { this.busy = false; }
  }
}

export async function waitForReadiness(check, { attempts = 60, wait = delay } = {}) {
  for (let i = 0; i < attempts; i++) {
    try { if (await check()) return; } catch { /* Retry startup without logging any credentials. */ }
    if (i + 1 < attempts) await wait(1000);
  }
  throw new Error('Anwendung wurde nicht rechtzeitig bereit.');
}
