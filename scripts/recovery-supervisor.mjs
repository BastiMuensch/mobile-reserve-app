import { createServer } from 'node:http';
import { readFile as nodeReadFile } from 'node:fs/promises';
import { spawn as nodeSpawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { BACKUP_ENV_KEYS } from './full-backup-runtime.mjs';

export const CONTROL_PORT = 3101;
export const APP_PORT = 3000;
export const DEFAULT_RUNTIME_DIR = '/app/recovery-runtime';
const DATA_ROOT = '/app/recovery-data/generations';
const BLOCKED_DESCRIPTOR_KEYS = new Set(['SETUP_TOKEN', 'CRON_SECRET', 'NEXT_PUBLIC_APP_URL']);
// Upload paths are structural descriptor fields, never arbitrary environment values.
const ALLOWED_DESCRIPTOR_KEYS = new Set(BACKUP_ENV_KEYS.filter(key => !BLOCKED_DESCRIPTOR_KEYS.has(key) && key !== 'PRIVATE_UPLOADS_DIR'));

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validGeneration(value) {
  return value === 'baseline' || (typeof value === 'string' && /^[a-f0-9]{32}$/.test(value));
}

/** Validate the untrusted, manager-written active descriptor. */
export function validateDescriptor(value) {
  if (!isPlainObject(value)) throw new Error('Invalid recovery descriptor');
  const allowedFields = new Set(['generation', 'environment', 'publicUploadsDir', 'privateSignaturesDir', 'paused', 'notificationsPaused']);
  if (Object.keys(value).some(key => !allowedFields.has(key)) || !validGeneration(value.generation) || !isPlainObject(value.environment)) {
    throw new Error('Invalid recovery descriptor');
  }
  if ((value.paused !== undefined && typeof value.paused !== 'boolean') || (value.notificationsPaused !== undefined && typeof value.notificationsPaused !== 'boolean')) throw new Error('Invalid recovery descriptor');
  for (const [key, entry] of Object.entries(value.environment)) {
    if (!ALLOWED_DESCRIPTOR_KEYS.has(key) || typeof entry !== 'string') throw new Error('Invalid recovery descriptor environment');
  }
  const root = `${DATA_ROOT}/${value.generation}`;
  if (value.publicUploadsDir !== undefined && value.publicUploadsDir !== `${root}/public-uploads`) throw new Error('Invalid public upload path');
  if (value.privateSignaturesDir !== undefined && ![`${root}/private-uploads/signatures`, `${root}/custom-signatures`].includes(value.privateSignaturesDir)) {
    throw new Error('Invalid private signature path');
  }
  return {
    generation: value.generation,
    environment: { ...value.environment },
    ...(value.publicUploadsDir ? { publicUploadsDir: value.publicUploadsDir } : {}),
    ...(value.privateSignaturesDir ? { privateSignaturesDir: value.privateSignaturesDir } : {}),
    paused: value.paused === true,
    notificationsPaused: value.notificationsPaused === true,
  };
}

export function safeTokenEquals(expected, received) {
  if (typeof expected !== 'string' || expected.length < 32 || typeof received !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  // Compare equal-sized buffers only; a length mismatch is never accepted.
  return left.length === right.length && timingSafeEqual(left, right);
}

/** @typedef {{generation: string, environment: Record<string,string>, publicUploadsDir?: string, privateSignaturesDir?: string, paused?: boolean, notificationsPaused?: boolean}} Descriptor */

export class RecoverySupervisor {
  /** @param {{env?: Record<string,string|undefined>, cwd?: string, runtimeDir?: string, spawn?: typeof nodeSpawn, readFile?: (path: string, encoding: string) => Promise<string>, setTimeout?: typeof globalThis.setTimeout, clearTimeout?: typeof globalThis.clearTimeout, stopTimeoutMs?: number, onUnexpectedExit?: () => void}} [options] */
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.cwd = options.cwd || process.cwd();
    this.runtimeDir = options.runtimeDir || this.env.RECOVERY_RUNTIME_DIR || DEFAULT_RUNTIME_DIR;
    this.spawn = options.spawn || nodeSpawn;
    this.readFile = options.readFile || nodeReadFile;
    this.setTimeout = options.setTimeout || globalThis.setTimeout;
    this.clearTimeout = options.clearTimeout || globalThis.clearTimeout;
    this.stopTimeoutMs = options.stopTimeoutMs || 10_000;
    this.onUnexpectedExit = options.onUnexpectedExit || (() => {});
    this.child = null;
    this.generation = null;
    this.stoppingChild = null;
    this.operation = Promise.resolve();
  }

  status() { return { running: this.child !== null, generation: this.generation }; }

  async readDescriptor() {
    try {
      return validateDescriptor(JSON.parse(await this.readFile(`${this.runtimeDir}/active.json`, 'utf8')));
    } catch (error) {
      if (error && error.code === 'ENOENT') return { generation: 'baseline', environment: {}, paused: false, notificationsPaused: false };
      throw new Error('Recovery descriptor unavailable or invalid');
    }
  }

  childEnvironment(descriptor) {
    const childEnv = { ...this.env };
    for (const key of ['RECOVERY_CONTROL_TOKEN', 'RECOVERY_MODE', 'RECOVERY_STATE_DIR', 'RECOVERY_DATABASE_URL', 'RECOVERY_RESCUE_TOKEN']) delete childEnv[key];
    if (descriptor.generation !== 'baseline') {
      // A restored generation is entirely described by its validated backup descriptor.
      // Do not let optional SMTP/VAPID/demo/scheduler values bleed in from the target.
      for (const key of ALLOWED_DESCRIPTOR_KEYS) delete childEnv[key];
      for (const key of ['RECOVERY_READ_ONLY', 'NOTIFICATION_SUPPRESSED', 'PUBLIC_UPLOADS_DIR', 'PRIVATE_UPLOADS_DIR', 'FULL_BACKUP_PRIVATE_ROOT']) delete childEnv[key];
    }
    Object.assign(childEnv, descriptor.environment);
    childEnv.RECOVERY_GENERATION = descriptor.generation;
    if (descriptor.publicUploadsDir) childEnv.PUBLIC_UPLOADS_DIR = descriptor.publicUploadsDir;
    if (descriptor.privateSignaturesDir) {
      childEnv.PRIVATE_UPLOADS_DIR = descriptor.privateSignaturesDir;
      childEnv.FULL_BACKUP_PRIVATE_ROOT = `${DATA_ROOT}/${descriptor.generation}/private-uploads`;
    }
    if (descriptor.paused) childEnv.RECOVERY_READ_ONLY = 'true';
    if (descriptor.paused || descriptor.notificationsPaused) Object.assign(childEnv, {
      OUTBOX_SCHEDULER: 'off', GDPR_CLEANUP_SCHEDULER: 'off', NOTIFICATION_SUPPRESSED: 'true',
    });
    return childEnv;
  }

  /** @template T @param {() => Promise<T>} action @returns {Promise<T>} */
  enqueue(action) {
    const result = this.operation.then(action, action);
    this.operation = result.catch(() => {});
    return result;
  }

  async start() {
    return this.enqueue(async () => {
      const descriptor = await this.readDescriptor();
      if (this.child) {
        if (this.generation === descriptor.generation) return { ...this.status(), started: false };
        throw new Error('Recovery process is already running another generation');
      }
      const child = this.spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT)], {
        cwd: this.cwd, env: this.childEnvironment(descriptor), stdio: 'inherit', shell: false,
      });
      if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function') throw new Error('Unable to start recovery process');
      this.child = child;
      this.generation = descriptor.generation;
      const onExit = () => {
        child.removeListener?.('error', onError);
        if (this.child === child) {
          const intentional = this.stoppingChild === child;
          this.child = null;
          this.generation = null;
          this.stoppingChild = null;
          if (!intentional) this.onUnexpectedExit();
        }
      };
      const onError = () => {
        child.removeListener?.('exit', onExit);
        if (this.child === child) {
          const intentional = this.stoppingChild === child;
          this.child = null;
          this.generation = null;
          this.stoppingChild = null;
          if (!intentional) this.onUnexpectedExit();
        }
      };
      child.once('exit', onExit);
      child.once('error', onError);
      return { ...this.status(), started: true };
    });
  }

  async stop() {
    return this.enqueue(async () => {
      const child = this.child;
      if (!child) return { ...this.status(), stopped: false };
      this.stoppingChild = child;
      await new Promise((resolve, reject) => {
        let settled = false;
        let forceTimer = null;
        let finalTimer = null;
        const removeExitListener = () => child.removeListener?.('exit', exited);
        const finish = () => {
          if (settled) return;
          settled = true;
          if (forceTimer) this.clearTimeout(forceTimer);
          if (finalTimer) this.clearTimeout(finalTimer);
          resolve();
        };
        const fail = () => {
          if (settled) return;
          settled = true;
          if (forceTimer) this.clearTimeout(forceTimer);
          if (finalTimer) this.clearTimeout(finalTimer);
          removeExitListener();
          reject(new Error('Recovery process did not exit after SIGKILL'));
        };
        const exited = () => finish();
        forceTimer = this.setTimeout(() => {
          try { child.kill('SIGKILL'); }
          catch { return fail(); }
          if (!settled) finalTimer = this.setTimeout(fail, this.stopTimeoutMs);
        }, this.stopTimeoutMs);
        child.once('exit', exited);
        try { child.kill('SIGTERM'); }
        catch {
          if (forceTimer) this.clearTimeout(forceTimer);
          removeExitListener();
          settled = true;
          reject(new Error('Unable to terminate recovery process'));
        }
      });
      // The persistent child exit listener clears the reference before this resolves.
      if (this.child === child) throw new Error('Recovery process exit was not observed');
      return { ...this.status(), stopped: true };
    });
  }
}

export function createControlServer(supervisor, token) {
  return createServer(async (request, response) => {
    const reject = code => { response.writeHead(code, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: code === 401 ? 'unauthorized' : 'unavailable' })); };
    if (!safeTokenEquals(token, request.headers['x-recovery-control-token'])) return reject(401);
    try {
      if (request.method === 'GET' && request.url === '/status') {
        response.writeHead(200, { 'content-type': 'application/json' }); return response.end(JSON.stringify(supervisor.status()));
      }
      if (request.method === 'POST' && request.url === '/start') {
        const result = await supervisor.start(); response.writeHead(200, { 'content-type': 'application/json' }); return response.end(JSON.stringify(result));
      }
      if (request.method === 'POST' && request.url === '/stop') {
        const result = await supervisor.stop(); response.writeHead(200, { 'content-type': 'application/json' }); return response.end(JSON.stringify(result));
      }
      reject(404);
    } catch { reject(503); }
  });
}

export async function main(env = process.env) {
  let server = null;
  let shuttingDown = false;
  const supervisor = new RecoverySupervisor({ env, onUnexpectedExit: () => {
    if (shuttingDown) return;
    process.exitCode = 1;
    if (server) server.close(() => process.exit(1));
    else process.exit(1);
  } });
  if (!safeTokenEquals(env.RECOVERY_CONTROL_TOKEN, env.RECOVERY_CONTROL_TOKEN)) throw new Error('RECOVERY_CONTROL_TOKEN must be at least 32 characters');
  await supervisor.start();
  server = createControlServer(supervisor, env.RECOVERY_CONTROL_TOKEN);
  await new Promise(resolve => server.listen(CONTROL_PORT, '0.0.0.0', resolve));
  const shutdown = async () => {
    shuttingDown = true;
    server.close();
    try { await supervisor.stop(); process.exit(0); }
    catch { process.exit(1); }
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(() => process.exit(1));
