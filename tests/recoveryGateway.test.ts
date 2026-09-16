import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGateway } from '../scripts/recovery-gateway.mjs';

type GatewayResponse = { status: number, headers: Record<string, string | string[] | undefined>, body: string };

function fakeCoordinator(maintenance = true) {
  let loggedIn = false;
  return {
    state: { maintenance },
    canServe: () => !maintenance,
    loginAttempt: async () => {},
    createSession: async () => { loggedIn = true; return 'a'.repeat(64); },
    session: (token: string | undefined) => loggedIn && token === 'a'.repeat(64) ? { mode: 'password' } : null,
    logout: async () => { loggedIn = false; },
    publicStatus: () => ({ phase: 'completed', maintenance, notificationsPaused: true, summary: { counts: { users: 1 } } }),
    active: async () => ({ generation: 'baseline', environment: {} }),
    beginUpload: async () => '/definitely/not/used', finishUpload: async () => {},
    prepare: () => {}, commit: () => {}, resume: () => {}, cancel: async () => {}, background: Promise.resolve(),
  };
}

async function startGateway({ maintenance = true, web, initialized = true }: { maintenance?: boolean, web?: URL, initialized?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'recovery-gateway-'));
  const coordinator = fakeCoordinator(maintenance);
  const config = { origin: 'http://recovery.test', secure: false, web: web || new URL('http://127.0.0.1:1'), control: new URL('http://127.0.0.1:1'),
    stateDir: root, dataRoot: root, runtimeDir: root, adminDatabaseUrl: '', appVersion: '0.1.8', appCommit: 'test', migrationsDir: root,
    controlToken: 'c'.repeat(32), authToken: 'b'.repeat(32), rescueToken: 'd'.repeat(32) };
  const server = createGateway({ config, coordinator, authorize: async () => true, initialization: initialized ? Promise.resolve() : new Promise(() => {}) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  return { coordinator, base, close: async () => { server.close(); await once(server, 'close'); await rm(root, { recursive: true, force: true }); } };
}

function call(base: string, pathname: string, { method = 'GET', headers = {}, body }: { method?: string, headers?: Record<string, string>, body?: string } = {}) {
  return new Promise<GatewayResponse>((resolve, reject) => {
    const req = request(base, { method, path: pathname, headers }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
const jsonHeaders = { origin: 'http://recovery.test', 'content-type': 'application/json' };

test('gateway recovery status stays authenticated and available while the web application is down', async () => {
  const gateway = await startGateway({ maintenance: true });
  try {
    assert.equal((await call(gateway.base, '/')).status, 503);
    const login = await call(gateway.base, '/_recovery/api/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ password: 'x' }) });
    assert.equal(login.status, 200); const cookie = String(login.headers['set-cookie']).split(';')[0];
    assert.match(String(login.headers['set-cookie']), /HttpOnly/); assert.match(String(login.headers['set-cookie']), /SameSite=Strict/);
    const status = await call(gateway.base, '/_recovery/api/status', { headers: { cookie } });
    assert.equal(status.status, 200); assert.deepEqual(JSON.parse(status.body).summary.counts, { users: 1 });
    assert.match(String(status.headers['cache-control']), /no-store/);
    assert.equal((await call(gateway.base, '/api/backup/recovery/readiness')).status, 403);
  } finally { await gateway.close(); }
});

test('gateway enforces CSRF, JSON/body limits, logout, and keeps initialization closed', async () => {
  const gateway = await startGateway({ initialized: false });
  try {
    assert.equal((await call(gateway.base, '/_recovery/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'x' }) })).status, 403);
    assert.equal((await call(gateway.base, '/_recovery/api/login', { method: 'POST', headers: jsonHeaders, body: `{${'"x":"'.repeat(1000)}}` })).status, 400);
    const login = await call(gateway.base, '/_recovery/api/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ password: 'x' }) });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const status = await call(gateway.base, '/_recovery/api/status', { headers: { cookie } });
    assert.equal(status.status, 200); assert.equal(JSON.parse(status.body).phase, 'failed');
    assert.equal((await call(gateway.base, '/_recovery/api/logout', { method: 'POST', headers: { cookie } })).status, 403);
    const logout = await call(gateway.base, '/_recovery/api/logout', { method: 'POST', headers: { ...jsonHeaders, cookie }, body: '{}' });
    assert.equal(logout.status, 200); assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
    assert.equal((await call(gateway.base, '/_recovery/api/status', { headers: { cookie } })).status, 401);
  } finally { await gateway.close(); }
});

test('gateway blocks absolute-form request targets, strips proxy headers, and delegates uploads only to the internal media route', async () => {
  const seen: { headers?: Record<string, string | string[] | undefined>, urls: string[] } = { urls: [] };
  const upstream = createServer((request, response) => {
    seen.headers = request.headers; seen.urls.push(request.url || '');
    if (request.url?.startsWith('/api/backup/recovery/public-media/')) { response.writeHead(200, { 'content-type': 'image/png' }); response.end('image-from-web'); return; }
    response.end('upstream');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const address = upstream.address(); assert.ok(address && typeof address === 'object');
  const gateway = await startGateway({ maintenance: false, web: new URL(`http://127.0.0.1:${address.port}`) });
  try {
    const absolute = await call(gateway.base, 'http://127.0.0.1:1/not-a-proxy-target');
    assert.ok([400, 403].includes(absolute.status), `absolute request target must be rejected, got ${absolute.status}`);
    const proxied = await call(gateway.base, '/ordinary', { headers: { 'x-recovery-auth-token': 'browser-injected', 'x-recovery-control-token': 'browser-injected' } });
    assert.equal(proxied.status, 200); assert.equal(proxied.body, 'upstream');
    assert.equal(seen.headers?.['x-recovery-auth-token'], undefined); assert.equal(seen.headers?.['x-recovery-control-token'], undefined);
    const image = await call(gateway.base, '/uploads/photo.png');
    assert.equal(image.status, 200); assert.equal(image.body, 'image-from-web');
    assert.equal(image.headers['content-type'], 'image/png');
    assert.equal(seen.urls.at(-1), '/api/backup/recovery/public-media/photo.png');
    assert.equal(seen.headers?.['x-recovery-auth-token'], 'b'.repeat(32));
    assert.equal((await call(gateway.base, '/uploads/photo.png/extra')).status, 404);
  } finally { await gateway.close(); upstream.close(); await once(upstream, 'close'); }
});
