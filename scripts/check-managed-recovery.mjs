// CI only: real Docker Compose/Next/PostgreSQL browser-recovery round trip.
// Creates a fresh randomly named stack and removes ONLY its own test volumes.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

if (process.env.CI !== 'true') throw new Error('This destructive cleanup harness is for CI only.');
const exec = promisify(execFile);
const hex = () => randomBytes(32).toString('hex');
const project = `mr-recovery-ci-${randomBytes(8).toString('hex')}`;
const origin = 'http://127.0.0.1:3147';
const env = { ...process.env, APP_IMAGE: 'mobile-reserve-runtime-check', APP_PORT: '3147', POSTGRES_USER: 'reserve', POSTGRES_DB: 'mobile_reserve_test_managed',
  POSTGRES_PASSWORD: hex(), RECOVERY_DATABASE_PASSWORD: hex(), RECOVERY_AUTH_TOKEN: hex(), RECOVERY_CONTROL_TOKEN: hex(), RECOVERY_RESCUE_TOKEN: hex(),
  JWT_SECRET: hex(), SETUP_TOKEN: hex(), INVITATION_TOKEN_PEPPER: hex(), SMTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  NEXT_PUBLIC_APP_URL: origin, OUTBOX_SCHEDULER: 'off', GDPR_CLEANUP_SCHEDULER: 'off', UPDATE_CHECK_ENABLED: 'false' };
const compose = ['compose', '--env-file', '/dev/null', '-p', project, '-f', 'docker-compose.managed.yml'];
async function docker(args) {
  try { return (await exec('docker', args, { env, timeout: 240000, maxBuffer: 2 * 1024 * 1024 })).stdout; }
  catch { throw new Error('Isolated managed recovery CI Docker step failed.'); }
}
async function poll(callback, count = 100) {
  for (let i = 0; i < count; i++) { try { if (await callback()) return; } catch {} await delay(1000); }
  throw new Error('Managed recovery CI timed out.');
}
const password = 'synthetic-recovery-ci-password';
let appCookie = '', recoveryCookie = '';
async function api(route, body, cookie = recoveryCookie, binary = false) {
  return fetch(`${origin}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie,
    ...(body === undefined ? {} : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }) },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
}
const recovery = (route, body) => api(`/_recovery/api/${route}`, body);
try {
  await docker([...compose, 'up', '-d']);
  await poll(async () => (await api('/api/setup/status')).ok);
  // Synthetic account only in this new named CI stack; no real app records.
  await docker([...compose, 'exec', '-T', 'web', 'node', '-e', `const{PrismaClient}=require('@prisma/client');const b=require('bcryptjs');const d=new PrismaClient();(async()=>{await d.user.create({data:{email:'recovery-ci@example.invalid',role:'SCHULAMT',isActive:true,password:await b.hash('${password}',10)}});await d.$disconnect()})().catch(()=>process.exit(1));`]);
  const login = await api('/api/auth/login', { email: 'recovery-ci@example.invalid', password }, ''); assert.equal(login.status, 200);
  appCookie = login.headers.get('set-cookie').split(';')[0];
  const backupPassword = randomBytes(24).toString('base64url');
  const backup = await api('/api/backup/export', { password, backupPassword }, appCookie); assert.equal(backup.status, 200);
  const bytes = new Uint8Array(await backup.arrayBuffer());
  const authorize = await api('/_recovery/api/login', { password }, appCookie); assert.equal(authorize.status, 200);
  recoveryCookie = authorize.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/_recovery/api/upload', bytes, recoveryCookie, true)).status, 200);
  assert.equal((await recovery('prepare', { backupPassword })).status, 202);
  await poll(async () => (await (await recovery('status')).json()).phase === 'ready');
  const commit = await api('/_recovery/api/commit', { password, confirmation: 'WIEDERHERSTELLEN' }, `${recoveryCookie}; ${appCookie}`); assert.equal(commit.status, 202);
  // Control plane remains alive during real Next stop/restart.
  assert.equal((await recovery('status')).status, 200);
  await poll(async () => (await (await recovery('status')).json()).phase === 'completed');
  const result = await (await recovery('status')).json(); assert.equal(result.notificationsPaused, true); assert.ok(result.summary.counts.users >= 1);
  assert.equal((await api('/api/auth/me', undefined, appCookie)).status, 401, 'Restored sessions must be invalidated');
  const newLogin = await api('/api/auth/login', { email: 'recovery-ci@example.invalid', password }, ''); assert.equal(newLogin.status, 200);
  appCookie = newLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/auth/me', undefined, appCookie)).status, 200);
  const resume = await api('/_recovery/api/resume', { password, reviewedOutbox: true }, `${recoveryCookie}; ${appCookie}`); assert.equal(resume.status, 202);
  await poll(async () => { const s = await (await recovery('status')).json(); return s.phase === 'completed' && s.notificationsPaused === false; });
  console.log('Managed recovery CI passed: real encrypted browser upload, isolated generation, durable status, new login, explicit notification release.');
} finally {
  // The fixed compose file and generated project name confine all cleanup to
  // resources just created by this harness. Never use a user-supplied project.
  await docker([...compose, 'down', '--volumes', '--remove-orphans']);
}
