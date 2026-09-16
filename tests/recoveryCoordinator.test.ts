import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RecoveryCoordinator, atomicJson, hashToken } from '../scripts/recovery-coordinator.mjs';

const generation = 'b'.repeat(32);
const baseline = { generation: 'baseline', environment: {}, paused: false, notificationsPaused: false };

async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'recovery-coordinator-'));
  const events: string[] = [];
  const defaultRestore = async () => { events.push('restore'); return { counts: { users: 1 }, descriptor: { generation, environment: {} } }; };
  await atomicJson(path.join(root, 'runtime', 'active.json'), baseline);
  const coordinator = new RecoveryCoordinator({
    stateDir: path.join(root, 'state'), runtimeDir: path.join(root, 'runtime'), dataRoot: path.join(root, 'data'),
    inspect: async () => ({ summary: { label: 'safe summary' } }),
    restore: defaultRestore,
    control: async (action: string) => { events.push(action); },
    ready: async (id: string) => { events.push(`ready:${id}`); },
    ...overrides,
  } as any);
  await coordinator.initialize();
  events.length = 0;
  return { root, coordinator, events };
}

async function readyJob(coordinator: RecoveryCoordinator) {
  coordinator.state = { phase: 'ready', jobId: 'c'.repeat(32), maintenance: false, sessions: [], attempts: [], summary: { label: 'test' } } as any;
  await coordinator.save();
}

test('sessions are durable control-plane credentials and never persist plaintext tokens', async () => {
  let now = 10_000;
  const { root, coordinator } = await fixture({ now: () => now });
  const token = await coordinator.createSession('operator');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((coordinator.session(token) as any)?.mode, 'operator');
  const stored = await readFile(path.join(root, 'state', 'state.json'), 'utf8');
  assert.equal(stored.includes(token), false);
  assert.ok(stored.includes(hashToken(token)));

  const reloaded = new RecoveryCoordinator({
    stateDir: path.join(root, 'state'), runtimeDir: path.join(root, 'runtime'), dataRoot: path.join(root, 'data'),
    inspect: async () => ({ summary: {} }), restore: async () => ({ counts: {}, descriptor: baseline }), control: async () => {}, ready: async () => {}, now: () => now,
  });
  await reloaded.initialize();
  assert.equal((reloaded.session(token) as any)?.mode, 'operator');
  now += 61 * 60 * 1000;
  assert.equal(reloaded.session(token), null);
});

test('login attempts are durably rate limited', async () => {
  const { coordinator } = await fixture();
  for (let i = 0; i < 10; i++) await coordinator.loginAttempt();
  await assert.rejects(coordinator.loginAttempt(), /Zu viele Anmeldeversuche/);
});

test('a failed prepare leaves baseline active and a reload does not cancel a ready job', async () => {
  const { root, coordinator } = await fixture({ inspect: async () => { throw new Error('bad archive'); } });
  await coordinator.beginUpload();
  await coordinator.finishUpload(true);
  coordinator.prepare('password');
  await coordinator.background;
  assert.equal(coordinator.state.phase, 'failed');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'runtime', 'active.json'), 'utf8')), baseline);

  coordinator.state = { phase: 'ready', jobId: 'd'.repeat(32), maintenance: false, sessions: [], attempts: [], summary: { label: 'durable' } } as any;
  await coordinator.save();
  const reopened = new RecoveryCoordinator({
    stateDir: path.join(root, 'state'), runtimeDir: path.join(root, 'runtime'), dataRoot: path.join(root, 'data'),
    inspect: async () => ({ summary: {} }), restore: async () => ({ counts: {}, descriptor: baseline }), control: async () => {}, ready: async () => {},
  });
  await reopened.initialize();
  assert.equal(reopened.state.phase, 'ready');
  assert.equal((reopened.state as any).jobId, 'd'.repeat(32));
});

test('commit journals and switches in stop, restore, staged-health, final-health, public order', async () => {
  const { root, coordinator, events } = await fixture();
  await readyJob(coordinator);
  const activate = coordinator.activate.bind(coordinator);
  coordinator.activate = async (descriptor: any) => { events.push(`descriptor:${descriptor.generation}:${descriptor.paused}:${descriptor.notificationsPaused}`); await activate(descriptor); };
  const save = coordinator.save.bind(coordinator);
  coordinator.save = async () => { await save(); if (coordinator.state.phase === 'completed' && !coordinator.state.maintenance) events.push('public-complete'); };
  coordinator.commit();
  await coordinator.background;
  assert.deepEqual(events, [
    'stop', 'restore', 'descriptor:' + generation + ':true:true', 'start', 'ready:' + generation,
    'stop', 'descriptor:' + generation + ':false:true', 'start', 'ready:' + generation, 'public-complete',
  ]);
  assert.equal(coordinator.state.phase, 'completed');
  assert.equal(coordinator.state.maintenance, false);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'runtime', 'active.json'), 'utf8')), { generation, environment: {}, paused: false, notificationsPaused: true });
});

test('staged readiness failure rolls back the old descriptor; rollback failure stays fail-closed', async () => {
  const { root, coordinator, events } = await fixture({ ready: async (id: string) => { if (id === generation) throw new Error('not ready'); } });
  await readyJob(coordinator);
  coordinator.commit();
  await coordinator.background;
  assert.equal(coordinator.state.phase, 'rolled_back');
  assert.equal(coordinator.state.maintenance, false);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'runtime', 'active.json'), 'utf8')), baseline);
  assert.deepEqual(events, ['stop', 'restore', 'start', 'stop', 'start']);

  const stageFailure = await fixture();
  await readyJob(stageFailure.coordinator);
  const activate = stageFailure.coordinator.activate.bind(stageFailure.coordinator);
  let failStage = true;
  stageFailure.coordinator.activate = async (descriptor: any) => {
    if (descriptor.generation === generation && failStage) { failStage = false; throw new Error('descriptor mount unavailable'); }
    await activate(descriptor);
  };
  stageFailure.coordinator.commit();
  await stageFailure.coordinator.background;
  assert.equal(stageFailure.coordinator.state.phase, 'rolled_back');
  assert.deepEqual(JSON.parse(await readFile(path.join(stageFailure.root, 'runtime', 'active.json'), 'utf8')), baseline);

  const broken = await fixture();
  broken.coordinator.control = async (action: string) => { if (action === 'start') throw new Error('no process'); };
  await readyJob(broken.coordinator);
  broken.coordinator.commit();
  await broken.coordinator.background;
  assert.equal(broken.coordinator.state.phase, 'failed');
  assert.equal(broken.coordinator.state.maintenance, true);
});

test('restart during committing or verifying rolls back its persisted previous generation', async () => {
  for (const phase of ['committing', 'verifying']) {
    const { root, coordinator } = await fixture();
    await atomicJson(path.join(root, 'runtime', 'active.json'), { generation, environment: {}, paused: true, notificationsPaused: true });
    coordinator.state = { phase, maintenance: true, previous: baseline, sessions: [], attempts: [] } as any;
    await coordinator.save();
    const restarted = new RecoveryCoordinator({
      stateDir: path.join(root, 'state'), runtimeDir: path.join(root, 'runtime'), dataRoot: path.join(root, 'data'),
      inspect: async () => ({ summary: {} }), restore: async () => ({ counts: {}, descriptor: baseline }), control: async () => {}, ready: async () => {},
    });
    await restarted.initialize();
    assert.equal(restarted.state.phase, 'rolled_back');
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'runtime', 'active.json'), 'utf8')), baseline);
  }
});

test('a concurrent commit is rejected and resuming only flips notification pause on the same generation', async () => {
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const { root, coordinator } = await fixture({ restore: async () => { await held; return { counts: {}, descriptor: { generation, environment: {} } }; } });
  await readyJob(coordinator);
  coordinator.commit();
  assert.throws(() => coordinator.commit(), /läuft bereits/);
  release!(); await coordinator.background;

  coordinator.resume();
  await coordinator.background;
  const descriptor = JSON.parse(await readFile(path.join(root, 'runtime', 'active.json'), 'utf8'));
  assert.equal(descriptor.generation, generation);
  assert.equal(descriptor.paused, false);
  assert.equal(descriptor.notificationsPaused, false);
});

test('the public gate stays closed until the final completion journal is durable', async () => {
  const { coordinator } = await fixture();
  await readyJob(coordinator);
  const save = coordinator.save.bind(coordinator);
  let release!: () => void;
  let reached!: () => void;
  const finalSaveReached = new Promise<void>(resolve => { reached = resolve; });
  const deferred = new Promise<void>(resolve => { release = resolve; });
  coordinator.save = async () => {
    if (coordinator.state.phase === 'completed' && coordinator.state.maintenance === false) {
      reached();
      await deferred;
    }
    await save();
  };
  coordinator.commit();
  await finalSaveReached;
  assert.equal(coordinator.state.phase, 'completed');
  assert.equal(coordinator.state.maintenance, false);
  assert.equal(coordinator.busy, true);
  assert.equal((coordinator as any).canServe(), false, 'in-memory completion must not open traffic before its journal fsync');
  release();
  await coordinator.background;
  assert.equal((coordinator as any).canServe(), true);
});

test('a final completion journal failure rolls back before traffic can serve the new generation', async () => {
  const { root, coordinator } = await fixture();
  await readyJob(coordinator);
  const save = coordinator.save.bind(coordinator);
  let failCompletion = true;
  coordinator.save = async () => {
    if (failCompletion && coordinator.state.phase === 'completed' && coordinator.state.maintenance === false) {
      failCompletion = false;
      throw new Error('state disk unavailable');
    }
    await save();
  };
  coordinator.commit();
  await coordinator.background;
  assert.equal(coordinator.state.phase, 'rolled_back');
  assert.equal(coordinator.state.maintenance, false);
  assert.equal((coordinator as any).canServe(), true, 'only the known previous generation may reopen after a successful rollback');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'runtime', 'active.json'), 'utf8')), baseline);
});

test('public status exposes no descriptor environment or secret material', async () => {
  const { coordinator } = await fixture();
  coordinator.state = { phase: 'completed', jobId: 'e'.repeat(32), maintenance: false, notificationsPaused: true, sessions: [{ hash: 'secret-hash', expires: Date.now() + 1000 }], attempts: [], summary: { environment: { DATABASE_URL: 'postgresql://secret' } } } as any;
  const status = coordinator.publicStatus();
  assert.deepEqual(Object.keys(status).sort(), ['error', 'jobId', 'maintenance', 'notificationsPaused', 'phase', 'summary']);
  assert.equal(JSON.stringify(status).includes('secret-hash'), false);
  assert.equal(JSON.stringify(status).includes('postgresql://secret'), false);
});
