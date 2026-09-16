import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConfiguration, prepareInstance, publicOrigin } from '../scripts/setup-instance.mjs';

const options = { url: 'https://office.example.invalid/', version: '0.1.9', port: 3120 };

test('installer creates independent keys, pinned image and a valid matching VAPID pair', () => {
  const env = createConfiguration(options);
  assert.equal(env.NEXT_PUBLIC_APP_URL, 'https://office.example.invalid');
  assert.equal(env.APP_IMAGE, 'ghcr.io/bastimuensch/mobile-reserve-app:0.1.9');
  const secrets = ['JWT_SECRET', 'SETUP_TOKEN', 'POSTGRES_PASSWORD', 'RECOVERY_DATABASE_PASSWORD', 'INVITATION_TOKEN_PEPPER', 'RECOVERY_AUTH_TOKEN', 'RECOVERY_CONTROL_TOKEN', 'RECOVERY_RESCUE_TOKEN', 'CRON_SECRET'] as const;
  assert.equal(new Set(secrets.map(key => env[key])).size, secrets.length);
  for (const key of secrets) assert.match(env[key], /^[a-f0-9]{64}$/);
  assert.equal(Buffer.from(env.SMTP_ENCRYPTION_KEY, 'base64').length, 32);
  const key = createECDH('prime256v1');
  key.setPrivateKey(Buffer.from(env.VAPID_PRIVATE_KEY, 'base64url'));
  assert.equal(key.getPublicKey().toString('base64url'), env.VAPID_PUBLIC_KEY);
  const another = createConfiguration(options);
  assert.notEqual(another.COMPOSE_PROJECT_NAME, env.COMPOSE_PROJECT_NAME);
  for (const name of secrets) assert.notEqual(another[name], env[name]);
});

test('installer rejects unsafe origins, invalid ports and moving image tags', () => {
  for (const url of ['http://example.invalid', 'https://user:pass@example.invalid', 'https://example.invalid/path', 'https://example.invalid/?token=secret', 'https://example.invalid/#hash', 'https://example$INJECT.invalid']) {
    assert.throws(() => publicOrigin(url));
  }
  for (const port of [0, 80, 65536, 3.5, NaN]) assert.throws(() => createConfiguration({ ...options, port }));
  for (const version of ['latest', 'main', '0.1.9\nJWT_SECRET=bad', '0.1.9-dev']) assert.throws(() => createConfiguration({ ...options, version }));
});

test('installer prepares private files only, never replaces existing configuration on repeat', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'mr-installer-test-'));
  const directory = path.join(parent, 'new-instance');
  try {
    const result = await prepareInstance({ ...options, directory });
    const before = await readFile(path.join(directory, '.env'), 'utf8');
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(directory, '.env'))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(directory, 'ZUGANGSDATEN.txt'))).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(directory)).sort(), ['.env', 'START.md', 'ZUGANGSDATEN.txt', 'docker-compose.yml']);
    assert.match(before, new RegExp(`COMPOSE_PROJECT_NAME=${result.projectName}`));
    assert.equal(JSON.stringify(result).includes('JWT_SECRET'), false);
    const guide = await readFile(path.join(directory, 'START.md'), 'utf8');
    const env = Object.fromEntries(before.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    assert.equal(guide.includes(env.JWT_SECRET), false);
    assert.equal(guide.includes(env.SETUP_TOKEN), false);
    assert.match(guide, /config --quiet/);
    assert.ok(guide.includes(`--project-name '${result.projectName}'`));
    await assert.rejects(prepareInstance({ ...options, directory }));
    assert.equal(await readFile(path.join(directory, '.env'), 'utf8'), before);
    const template = await readFile(path.join(directory, 'docker-compose.yml'), 'utf8');
    assert.match(template, /127\.0\.0\.1:/);
    assert.equal(template.includes('/var/run/docker.sock'), false);
    for (const match of template.matchAll(/\$\{([A-Z_]+):\?[^}]*\}/g)) {
      assert.ok(env[match[1]], `Required Compose setting not generated: ${match[1]}`);
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('installer and checker are included in the production image; handoff secrets are excluded from git/build', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  for (const file of ['setup-instance.mjs', 'check-installation.mjs', 'docker-compose.managed.yml']) assert.ok(dockerfile.includes(`/app/${file.endsWith('.mjs') ? 'scripts/' : ''}${file}`));
  for (const filename of ['.dockerignore', '.gitignore']) {
    assert.ok((await readFile(new URL(`../${filename}`, import.meta.url), 'utf8')).includes('**/ZUGANGSDATEN.txt'));
  }
});

test('installer refuses a symlink target and validates input before creating files', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'mr-installer-symlink-'));
  try {
    const link = path.join(parent, 'link');
    await symlink(parent, link);
    await assert.rejects(prepareInstance({ ...options, directory: link }));
    await assert.rejects(prepareInstance({ ...options, url: 'http://invalid', directory: path.join(parent, 'invalid') }));
    assert.deepEqual(await readdir(parent), ['link']);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
