import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkloadLoader, type WorkloadLoadState } from '../src/lib/workloadClient';
import { buildWorkloadReport } from '../src/lib/workload';

const report = buildWorkloadReport('2026/2027', [], new Date('2026-10-08T10:00:00Z'));
const response = () => Response.json(report);

test('refresh ticks share a slow request instead of aborting it', async () => {
  let resolve!: (response: Response) => void;
  let calls = 0;
  const states: WorkloadLoadState[] = [];
  const loader = createWorkloadLoader(report.schoolYear, state => states.push(state), {
    fetcher: async () => { calls++; return new Promise<Response>(done => { resolve = done; }); },
  });
  const first = loader.refresh();
  await Promise.resolve();
  assert.equal(loader.refresh(), first);
  assert.equal(calls, 1);
  resolve(response());
  await first;
  assert.equal(states.at(-1)?.loading, false);
  assert.deepEqual(states.at(-1)?.report, report);
  await Promise.resolve();
  const next = loader.refresh();
  await Promise.resolve();
  resolve(response());
  await next;
  assert.equal(calls, 2);
  loader.dispose();
});

test('failed refresh retains the visible last report with an explicit error', async () => {
  let fail = false;
  let state: WorkloadLoadState | undefined;
  const loader = createWorkloadLoader(report.schoolYear, value => { state = value; }, {
    fetcher: async () => { if (fail) throw new Error('offline'); return response(); },
  });
  await loader.refresh();
  fail = true;
  await loader.refresh();
  assert.deepEqual(state?.report, report);
  assert.equal(state?.loading, false);
  assert.match(state?.error ?? '', /erneut versuchen/);
  loader.dispose();
});

test('disposed year loader cannot publish a late response', async () => {
  let resolve!: (response: Response) => void;
  const states: WorkloadLoadState[] = [];
  const loader = createWorkloadLoader(report.schoolYear, state => states.push(state), {
    fetcher: async () => new Promise<Response>(done => { resolve = done; }),
  });
  const pending = loader.refresh();
  await Promise.resolve();
  loader.dispose();
  resolve(response());
  await pending;
  assert.equal(states.length, 1);
  await loader.refresh();
  assert.equal(states.length, 1);
});

test('timeout and wrong-year payload produce a retryable error', async () => {
  for (const timeout of [true, false]) {
    let state: WorkloadLoadState | undefined;
    const loader = createWorkloadLoader(report.schoolYear, value => { state = value; }, {
      timeoutMs: 5,
      fetcher: async (_url, init) => timeout ? new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }) : Response.json({ ...report, schoolYear: '2025/2026' }),
    });
    await loader.refresh();
    assert.equal(state?.loading, false);
    assert.equal(state?.report, null);
    assert.ok(state?.error);
    loader.dispose();
  }
});

test('synchronous fetch failures do not lock out retries', async () => {
  let calls = 0;
  const loader = createWorkloadLoader(report.schoolYear, () => {}, { fetcher: () => { calls++; throw new Error('offline'); } });
  await loader.refresh();
  await loader.refresh();
  assert.equal(calls, 2);
  loader.dispose();
});
