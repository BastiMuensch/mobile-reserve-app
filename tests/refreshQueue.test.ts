import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefreshQueue, type RefreshTask } from '../src/lib/refreshQueue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('repeated refreshes preserve a slow initial request and combine into one follow-up', async () => {
  const first = deferred();
  const followUp = deferred();
  const tasks: RefreshTask[] = [];
  const published: string[] = [];
  const queue = createRefreshQueue(async (task, name: string) => {
    tasks.push(task);
    await (tasks.length === 1 ? first.promise : followUp.promise);
    if (!task.cancelled) published.push(name);
  });
  const completion = queue.refresh('initial');
  await Promise.resolve();
  const refreshCompletion = queue.refresh('focus');
  queue.refresh('poll');
  queue.refresh('mutation');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].signal.aborted, false);
  assert.equal(refreshCompletion, completion);
  first.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(published, ['initial']);
  assert.equal(tasks.length, 2);
  followUp.resolve();
  await completion;
  assert.deepEqual(published, ['initial', 'mutation']);
});

test('cancelling a view discards queued work and rejects stale results after a replacement starts', async () => {
  const first = deferred();
  const tasks: RefreshTask[] = [];
  const published: string[] = [];
  const queue = createRefreshQueue(async (task, year: string) => {
    tasks.push(task);
    if (year === 'old') await first.promise;
    if (!task.cancelled) published.push(year);
  });
  const original = queue.refresh('old');
  await Promise.resolve();
  queue.refresh('queued old');
  queue.cancel();
  const replacement = queue.refresh('new');
  await replacement;
  assert.equal(tasks[0].signal.aborted, true);
  assert.equal(tasks[0].cancelled, true);
  first.resolve();
  await original;
  assert.deepEqual(published, ['new']);
  assert.equal(tasks.length, 2);
});

test('timeouts release stalled fetches and remain distinguishable from view cancellation', async () => {
  const finished: { timedOut: boolean; cancelled: boolean }[] = [];
  const queue = createRefreshQueue(async task => {
    await new Promise<void>(resolve => task.signal.addEventListener('abort', () => resolve(), { once: true }));
    finished.push({ timedOut: task.timedOut, cancelled: task.cancelled });
  }, 5);
  await queue.refresh();
  await queue.refresh();
  assert.deepEqual(finished, [{ timedOut: true, cancelled: false }, { timedOut: true, cancelled: false }]);
});

test('an effect cleaned up before its request starts does not fetch and can mount again', async () => {
  let calls = 0;
  const queue = createRefreshQueue(async () => { calls += 1; });
  const first = queue.refresh();
  queue.cancel();
  await first;
  assert.equal(calls, 0);
  await queue.refresh();
  assert.equal(calls, 1);
});
