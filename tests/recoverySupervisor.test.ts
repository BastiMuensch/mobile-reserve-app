import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RecoverySupervisor, safeTokenEquals, validateDescriptor } from '../scripts/recovery-supervisor.mjs';

const generation = 'a'.repeat(32);
class FakeChild extends EventEmitter {
  signals: string[] = [];
  kill(signal: string) { this.signals.push(signal); if (signal === 'SIGTERM') queueMicrotask(() => this.emit('exit', 0)); return true; }
}
class SilentChild extends EventEmitter {
  signals: string[] = [];
  kill(signal: string) { this.signals.push(signal); return true; }
}

test('descriptor validation confines generations, paths and environment', () => {
  const valid = validateDescriptor({ generation, environment: { DATABASE_URL: 'postgresql://restored' }, publicUploadsDir: `/app/recovery-data/generations/${generation}/public-uploads`, privateSignaturesDir: `/app/recovery-data/generations/${generation}/custom-signatures`, paused: true, notificationsPaused: true });
  assert.equal(valid.paused, true);
  assert.equal(valid.notificationsPaused, true);
  assert.throws(() => validateDescriptor({ generation, environment: { PATH: '/tmp' } }));
  assert.throws(() => validateDescriptor({ generation, environment: {}, publicUploadsDir: '/tmp/uploads' }));
  assert.throws(() => validateDescriptor({ generation: 'upperCASE', environment: {} }));
  assert.throws(() => validateDescriptor({ generation, environment: { SETUP_TOKEN: 'bad' } }));
  assert.throws(() => validateDescriptor({ generation, environment: { PRIVATE_UPLOADS_DIR: '/arbitrary' } }));
});

test('token check requires a long exact token', () => {
  assert.equal(safeTokenEquals('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(safeTokenEquals('a'.repeat(32), 'b'.repeat(32)), false);
  assert.equal(safeTokenEquals('short', 'short'), false);
});

test('supervisor starts one sanitized child and serializes stop/start', async () => {
  const children: FakeChild[] = [];
  const descriptor = JSON.stringify({ generation, environment: { DATABASE_URL: 'postgresql://restored', SETUP_TOKEN: 'must-not-be-accepted' } });
  const supervisor = new RecoverySupervisor({
    env: { RECOVERY_CONTROL_TOKEN: 'x'.repeat(32), RECOVERY_MODE: 'managed', RECOVERY_STATE_DIR: '/state', RECOVERY_DATABASE_URL: 'postgresql://manager', RECOVERY_RESCUE_TOKEN: 'rescue', SETUP_TOKEN: 'original', CRON_SECRET: 'target-cron', NEXT_PUBLIC_APP_URL: 'https://target.invalid', SMTP_HOST: 'target-smtp', VAPID_PRIVATE_KEY: 'target-vapid', DEMO_MODE: 'true', OUTBOX_SCHEDULER: 'on', RECOVERY_READ_ONLY: 'true', NOTIFICATION_SUPPRESSED: 'true', PUBLIC_UPLOADS_DIR: '/target/public', PRIVATE_UPLOADS_DIR: '/target/private', FULL_BACKUP_PRIVATE_ROOT: '/target/private-root', PATH: '/usr/bin' },
    readFile: (async () => descriptor) as any,
    spawn: ((_cmd: string, _args: string[], options: { env: Record<string, string> }) => { const child = new FakeChild(); (child as any).options = options; children.push(child); return child; }) as any,
  });
  await assert.rejects(supervisor.start());
  assert.equal(children.length, 0);

  const clean = JSON.stringify({ generation, environment: { DATABASE_URL: 'postgresql://restored' }, paused: true, notificationsPaused: true });
  supervisor.readFile = (async () => clean) as any;
  const first = await supervisor.start();
  assert.equal(first.started, true);
  assert.equal(children.length, 1);
  const env = (children[0] as any).options.env;
  assert.equal(env.RECOVERY_CONTROL_TOKEN, undefined);
  assert.equal(env.RECOVERY_MODE, undefined);
  assert.equal(env.RECOVERY_DATABASE_URL, undefined);
  assert.equal(env.RECOVERY_RESCUE_TOKEN, undefined);
  assert.equal(env.DATABASE_URL, 'postgresql://restored');
  assert.equal(env.SETUP_TOKEN, 'original');
  assert.equal(env.CRON_SECRET, 'target-cron');
  assert.equal(env.NEXT_PUBLIC_APP_URL, 'https://target.invalid');
  assert.equal(env.SMTP_HOST, undefined);
  assert.equal(env.VAPID_PRIVATE_KEY, undefined);
  assert.equal(env.DEMO_MODE, undefined);
  assert.equal(env.PUBLIC_UPLOADS_DIR, undefined);
  assert.equal(env.PRIVATE_UPLOADS_DIR, undefined);
  assert.equal(env.FULL_BACKUP_PRIVATE_ROOT, undefined);
  assert.equal(env.OUTBOX_SCHEDULER, 'off');
  assert.equal(env.NOTIFICATION_SUPPRESSED, 'true');
  assert.equal(env.RECOVERY_GENERATION, generation);
  assert.equal((await supervisor.start()).started, false);
  await supervisor.stop();
  assert.deepEqual(children[0].signals, ['SIGTERM']);
  assert.equal(children[0].listenerCount('exit'), 0);
  assert.equal(children[0].listenerCount('error'), 0);
  assert.deepEqual(supervisor.status(), { running: false, generation: null });
});

test('missing descriptor uses the inherited baseline configuration', async () => {
  const children: FakeChild[] = [];
  const supervisor = new RecoverySupervisor({
    env: { RECOVERY_CONTROL_TOKEN: 'x'.repeat(32), PUBLIC_UPLOADS_DIR: '/baseline/public' },
    readFile: (async () => { const error: any = new Error('missing'); error.code = 'ENOENT'; throw error; }) as any,
    spawn: ((_cmd: string, _args: string[], options: { env: Record<string, string> }) => { const child = new FakeChild(); (child as any).options = options; children.push(child); return child; }) as any,
  });
  await supervisor.start();
  assert.equal(supervisor.status().generation, 'baseline');
  assert.equal((children[0] as any).options.env.RECOVERY_GENERATION, 'baseline');
  assert.equal((children[0] as any).options.env.PUBLIC_UPLOADS_DIR, '/baseline/public');
  await supervisor.stop();
});

test('notifications may remain paused after writes are re-enabled', () => {
  const supervisor = new RecoverySupervisor({ env: { RECOVERY_CONTROL_TOKEN: 'x'.repeat(32), RECOVERY_READ_ONLY: 'true', NOTIFICATION_SUPPRESSED: 'true' } });
  const env = supervisor.childEnvironment({ generation, environment: {}, paused: false, notificationsPaused: true });
  assert.equal(env.RECOVERY_READ_ONLY, undefined);
  assert.equal(env.OUTBOX_SCHEDULER, 'off');
  assert.equal(env.GDPR_CLEANUP_SCHEDULER, 'off');
  assert.equal(env.NOTIFICATION_SUPPRESSED, 'true');
  const resumed = supervisor.childEnvironment({ generation, environment: {}, paused: false, notificationsPaused: false });
  assert.equal(resumed.RECOVERY_READ_ONLY, undefined);
  assert.equal(resumed.NOTIFICATION_SUPPRESSED, undefined);
});

test('stop fails closed until the child actually exits, even after SIGKILL', async () => {
  const child = new SilentChild();
  const supervisor = new RecoverySupervisor({
    env: { RECOVERY_CONTROL_TOKEN: 'x'.repeat(32) }, stopTimeoutMs: 5,
    readFile: (async () => JSON.stringify({ generation, environment: {} })) as any,
    spawn: (() => child) as any,
  });
  await supervisor.start();
  await assert.rejects(supervisor.stop(), /did not exit/);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(supervisor.status(), { running: true, generation });
  assert.equal((await supervisor.start()).started, false, 'a failed stop cannot create a second child');
  assert.equal(child.listenerCount('exit'), 1, 'only the supervisor listener remains after a failed stop');
});

test('unexpected child exit is reported and private root is generation-scoped', async () => {
  const child = new FakeChild();
  let unexpected = 0;
  const supervisor = new RecoverySupervisor({
    env: { RECOVERY_CONTROL_TOKEN: 'x'.repeat(32) }, onUnexpectedExit: () => { unexpected += 1; },
    readFile: (async () => JSON.stringify({ generation, environment: {}, privateSignaturesDir: `/app/recovery-data/generations/${generation}/custom-signatures` })) as any,
    spawn: ((_cmd: string, _args: string[], options: any) => { (child as any).options = options; return child; }) as any,
  });
  await supervisor.start();
  assert.equal((child as any).options.env.FULL_BACKUP_PRIVATE_ROOT, `/app/recovery-data/generations/${generation}/private-uploads`);
  child.emit('exit', 1);
  assert.equal(unexpected, 1);
  assert.deepEqual(supervisor.status(), { running: false, generation: null });
});
