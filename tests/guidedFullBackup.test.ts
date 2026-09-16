import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { guidedRestore, validateRestorePort } from '../scripts/guided-full-backup.mjs';
import { extractBackup } from '../scripts/restore-full-backup.mjs';
import { encryptBackup, sha256 } from '../scripts/full-backup-format.mjs';

const source = () => ({ format: 'mobile-reserve-full-v1', createdAt: new Date().toISOString(), appVersion: '0.1.8', appCommit: 'test', postgresVersion: '16.14', customSignatures: false,
  environment: { DATABASE_URL: 'postgresql://test:test@postgres:5432/app', JWT_SECRET: 'not-a-real-secret' },
  database: { data: Buffer.from('PGDMP-unit-test').toString('base64'), sha256: sha256(Buffer.from('PGDMP-unit-test')) }, files: [] });

async function scenario({ confirm = 'WIEDERHERSTELLEN', start = '', fail = '', version = '0.1.8', passwordCorrect = true, collision = false } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mr-guided-test-'));
  const archive = path.join(dir, 'archive.mrbackup'), output = path.join(dir, 'target');
  const secret = randomBytes(24).toString('base64url');
  await writeFile(archive, await encryptBackup({ ...source(), appVersion: version }, secret));
  const replies = [archive, output, '3127', confirm, start], calls: string[][] = [], logs: string[] = [];
  try {
    const result = await guidedRestore({ extract: extractBackup, readPassword: async () => passwordCorrect ? secret : randomBytes(24).toString('base64url'),
      ask: async () => replies.shift() ?? '', log: (line: string) => logs.push(line), wait: async () => {},
      runDocker: async (args: string[]) => {
        calls.push(args);
        if (args[0] === 'context') return 'unix:///var/run/docker.sock';
        if (collision && args[0] === 'ps') return 'existing';
        if (fail && args.includes(fail)) throw Error('Synthetic failure');
        return '';
      } });
    const compose = JSON.parse(await readFile(path.join(output, 'compose.restore.json'), 'utf8').catch(() => '{}'));
    const notes = await readFile(path.join(output, 'ASSISTENT-ERGEBNIS.txt'), 'utf8').catch(() => '');
    return { result, calls, logs, compose, notes, error: null };
  } catch (error) { return { result: null, calls, logs, compose: null, notes: await readFile(path.join(output, 'ASSISTENT-ERGEBNIS.txt'), 'utf8').catch(() => ''), error }; }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('guided restore validates ports and refuses unsafe values', () => {
  assert.equal(validateRestorePort('3120'), 3120);
  for (const port of ['80', '0', '65536', '3120;echo', '1234abc', '-1234']) assert.throws(() => validateRestorePort(port));
});

test('guided restore does not start Docker resources before confirmation or with invalid backups', async () => {
  for (const options of [{ confirm: 'nein' }, { version: 'development' }, { passwordCorrect: false }, { collision: true }]) {
    const s = await scenario(options);
    assert.equal(s.calls.some(args => args.includes('up') || args.includes('run') || args.includes('stop')), false);
    assert.equal(s.notes.includes('up -d web'), false);
  }
});

test('guided restore uses separate project, safe mount, empty-DB guard and leaves app stopped by default', async () => {
  const s = await scenario();
  assert.equal(s.error, null);
  assert.equal(s.result!.reason, 'restored');
  assert.match(s.result!.project!, /^mr-restore-[a-f0-9]{16}$/);
  assert.deepEqual(s.compose.services.web.ports, ['127.0.0.1:3127:3000']);
  assert.equal(s.compose.services.web.environment.OUTBOX_SCHEDULER, 'off');
  assert.equal(s.calls.some(args => args.includes('LEERE-ZIELDATENBANK-WIEDERHERSTELLEN')), true);
  assert.equal(s.calls.some(args => args.includes('/restore/database.dump:ro') || args.some(a => a.endsWith(':/restore/database.dump:ro'))), true);
  assert.equal(s.calls.some(args => args.slice(-3).join(' ') === 'up -d web'), false);
  assert.equal(s.calls.at(-1)!.at(-1), 'stop');
  assert.match(s.notes, /vollständig wiederhergestellt/);
});

test('guided restore starts web only after explicit STARTEN and stops its own stack on failure', async () => {
  const started = await scenario({ start: 'STARTEN' });
  assert.equal(started.error, null);
  assert.equal(started.result!.started, true);
  assert.deepEqual(started.calls.at(-1)!.slice(-3), ['up', '-d', 'web']);
  const failed = await scenario({ fail: 'LEERE-ZIELDATENBANK-WIEDERHERSTELLEN', start: 'STARTEN' });
  assert.ok(failed.error);
  assert.equal(failed.calls.at(-1)!.at(-1), 'stop');
  assert.equal(failed.calls.some(args => args.includes('down') || args.includes('rm')), false);
  assert.equal(failed.calls.some(args => args.slice(-3).join(' ') === 'up -d web'), false);
  assert.equal(failed.notes.includes('up -d web'), false);
});
