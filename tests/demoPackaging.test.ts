import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, copyFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { packageDemo } from '../scripts/package-demo.mjs';
import { models } from '../scripts/demo-data.mjs';

const root = process.cwd();

test('standalone CLI can package a legacy seed with readable data and separate private credentials', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'demo-standalone-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const seedDir = path.join(temp, 'seed');
  await mkdir(seedDir);
  const data: Record<string, unknown[]> = Object.fromEntries(models.filter(model => !['schoolLocation', 'reserveReportingPeriod', 'governmentReport'].includes(model)).map(model => [model, []]));
  data.systemSetting = [{ id: 'demoMode', value: 'true' }];
  await writeFile(path.join(seedDir, 'demo-seed.json'), JSON.stringify({ format: 'mobile-reserve-demo-v1', start: '2026-09-14', schoolYear: '2026/2027', data }));
  await writeFile(path.join(seedDir, 'ZUGANGSDATEN.md'), 'Synthetic credential fixture');
  const output = path.join(temp, 'standalone');
  execFileSync(process.execPath, ['scripts/package-demo.mjs', '--output', output, '--seed-dir', seedDir], { cwd: root });
  const seed = JSON.parse(await readFile(path.join(output, 'data/demo-seed.json'), 'utf8'));
  assert.deepEqual(seed.data.schoolLocation, []);
  assert.deepEqual(seed.data.governmentReport, []);
  assert.equal((await stat(path.join(output, 'data/demo-seed.json'))).mode & 0o777, 0o644, 'Container user can read the seed even with a private umask');
  assert.equal((await stat(path.join(output, '.env'))).mode & 0o777, 0o600);
  assert.equal((await stat(`${output}-ZUGANGSDATEN.md`)).mode & 0o777, 0o600);
  const entries = execFileSync('tar', ['-tzf', `${output}.tar.gz`], { encoding: 'utf8' }).split('\n');
  assert.ok(entries.includes('.env'));
  assert.ok(entries.includes('data/demo-seed.json'));
  assert.ok(!entries.some(file => file.includes('ZUGANGSDATEN')));
});

test('update archive includes current Docker build inputs and preserves existing instance files', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'demo-package-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const result = await packageDemo({ output: path.join(temp, 'update') });
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(result.version, version);
  assert.match(await readFile(path.join(result.output, 'compose.yml'), 'utf8'), new RegExp(`APP_VERSION: ${version.replaceAll('.', '\\.')}\\-demo`));
  const entries = execFileSync('tar', ['-tzf', result.archive], { encoding: 'utf8' }).split('\n');
  assert.ok(entries.includes('app/scripts/full-backup-runtime.mjs'));
  assert.ok(entries.includes('app/scripts/recovery-supervisor.mjs'));
  assert.ok(entries.includes('app/docker-compose.managed.yml'));
  assert.ok(entries.includes('app/scripts/demo-instance.mjs'));
  assert.ok(entries.includes('app/prisma/migrations/20261005150000_school_locations/migration.sql'));
  assert.ok(!entries.some(file => /(^|\/)(\.env[^/]*|node_modules|\.git)(\/|$)|^(data|app\/public\/uploads|app\/private-uploads)(\/|$)/.test(file)));
  assert.ok(!entries.some(file => /ZUGANGSDATEN|\.dump$/.test(file)));
  const dockerfile = await readFile(path.join(result.output, 'app/Dockerfile'), 'utf8');
  for (const match of dockerfile.matchAll(/^COPY\s+--from=builder\s+(?:--\S+\s+)*\/app\/(\S+)\s+/gm)) {
    if (match[1] === '.next' || match[1].includes('*')) continue;
    await access(path.join(result.output, 'app', match[1]));
  }
  const installed = path.join(temp, 'installed');
  await mkdir(path.join(installed, 'data'), { recursive: true });
  await writeFile(path.join(installed, '.env'), 'original demo secrets');
  await writeFile(path.join(installed, 'data/demo-seed.json'), 'original demo seed');
  execFileSync('tar', ['-xzf', result.archive, '-C', installed]);
  assert.equal(await readFile(path.join(installed, '.env'), 'utf8'), 'original demo secrets');
  assert.equal(await readFile(path.join(installed, 'data/demo-seed.json'), 'utf8'), 'original demo seed');
  await assert.rejects(packageDemo({ output: result.output }), /existiert bereits/);
});

test('update runs backup before migration and never starts the app after a failed migration', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'demo-update-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const bin = path.join(temp, 'bin');
  await mkdir(bin);
  const emptyUploads = path.join(temp, 'uploads.tar.gz');
  const emptyDir = path.join(temp, 'empty');
  await mkdir(emptyDir);
  execFileSync('tar', ['-czf', emptyUploads, '-C', emptyDir, '.']);
  // Fake Docker captures the real shell workflow, including injected failures.
  await writeFile(path.join(bin, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$DEMO_TEST_LOG"
case "$*" in
  *'build demo-init') [ "$DEMO_TEST_FAIL" != build ] || exit 12 ;;
  *'demo-init node --input-type=module') cat >/dev/null; [ "$DEMO_TEST_FAIL" != identity ] || exit 13 ;;
  *'pg_dump '*) [ "$DEMO_TEST_FAIL" != backup ] || exit 14; printf 'fake-dump' ;;
  *'pg_restore --list') cat >/dev/null ;;
  *'tar -czf - public/uploads private-uploads') cat "$DEMO_TEST_UPLOADS" ;;
  *'run --rm --no-deps -T demo-init') [ "$DEMO_TEST_FAIL" != migration ] || exit 15 ;;
  *'demo-web node --input-type=module') cat >/dev/null ;;
esac
exit 0
`, { mode: 0o755 });
  for (const failure of ['', 'build', 'identity', 'backup', 'migration', 'missing-files']) {
    const dir = path.join(temp, failure || 'success');
    await mkdir(path.join(dir, 'data'), { recursive: true });
    await mkdir(path.join(dir, 'app'));
    await copyFile(path.join(root, 'demo/update.sh'), path.join(dir, 'update.sh'));
    for (const file of ['compose.yml', 'data/demo-seed.json', 'app/package.json', ...(failure === 'missing-files' ? [] : ['.env'])]) await writeFile(path.join(dir, file), 'unchanged');
    const log = path.join(dir, 'commands.log');
    await writeFile(log, '');
    const result = spawnSync('sh', [path.join(dir, 'update.sh')], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEMO_TEST_LOG: log, DEMO_TEST_UPLOADS: emptyUploads, DEMO_TEST_FAIL: failure }, encoding: 'utf8' });
    const commands = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean);
    assert.equal(result.status === 0, !failure, `${failure}: ${result.stderr}`);
    const stop = commands.findIndex(line => line.endsWith('stop demo-web'));
    const backup = commands.findIndex(line => line.includes('pg_dump'));
    const migrate = commands.findIndex(line => line.endsWith('run --rm --no-deps -T demo-init'));
    const start = commands.findIndex(line => line.includes('up -d --no-deps --force-recreate demo-web'));
    if (!failure) {
      assert.ok(stop >= 0 && backup > stop && migrate > backup && start > migrate);
    } else {
      assert.equal(start, -1, failure);
      if (['build', 'identity', 'missing-files'].includes(failure)) assert.equal(stop, -1, failure);
      if (failure === 'backup') assert.equal(migrate, -1);
    }
    assert.equal(await readFile(path.join(dir, 'data/demo-seed.json'), 'utf8'), 'unchanged');
    if (failure !== 'missing-files') assert.equal(await readFile(path.join(dir, '.env'), 'utf8'), 'unchanged');
  }
});
