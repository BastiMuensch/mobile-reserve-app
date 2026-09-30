import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { startSessionRefresh } from '../src/lib/sessionRefresh';

function browser(t: TestContext) {
  const cleanups: (() => void)[] = [];
  t.after(() => { for (const cleanup of cleanups) cleanup(); });
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const navigator = { onLine: true };
  for (const [name, value] of Object.entries({ window, document, navigator })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  return { window, document, navigator, advance: (ms: number) => { now += ms; }, onCleanup: (cleanup: () => void) => cleanups.push(cleanup) };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('refreshes on opening, foreground return and activity, with hourly throttling and no background renewal', async t => {
  const b = browser(t);
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  const stop = startSessionRefresh(() => assert.fail('unexpected logout'));
  b.onCleanup(stop);
  await settle();
  assert.equal(fetcher.mock.callCount(), 1);
  assert.equal(fetcher.mock.calls[0].arguments[0], '/api/auth/refresh');
  assert.equal(fetcher.mock.calls[0].arguments[1]?.method, 'POST');
  b.window.dispatchEvent(new Event('pointerdown'));
  b.window.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(fetcher.mock.callCount(), 1);

  b.advance(60 * 60 * 1000);
  b.document.visibilityState = 'hidden';
  b.window.dispatchEvent(new Event('focus'));
  b.window.dispatchEvent(new Event('app-refresh'));
  await settle();
  assert.equal(fetcher.mock.callCount(), 1);
  b.document.visibilityState = 'visible';
  b.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(fetcher.mock.callCount(), 2);

  b.advance(60 * 60 * 1000);
  b.window.dispatchEvent(new Event('keydown'));
  await settle();
  assert.equal(fetcher.mock.callCount(), 3);
  stop();
  b.advance(60 * 60 * 1000);
  b.window.dispatchEvent(new Event('pointerdown'));
  b.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(fetcher.mock.callCount(), 3, 'logout removes renewal listeners');
});

test('offline and server failures preserve the session; later activity retries and a 401 invalidates once', async t => {
  const b = browser(t);
  b.navigator.onLine = false;
  let status = 503;
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status }));
  const unauthorized = t.mock.fn();
  const stop = startSessionRefresh(unauthorized);
  b.onCleanup(stop);
  await settle();
  assert.equal(fetcher.mock.callCount(), 0);
  b.navigator.onLine = true;
  b.window.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(fetcher.mock.callCount(), 1);
  assert.equal(unauthorized.mock.callCount(), 0);
  b.window.dispatchEvent(new Event('pointerdown'));
  await settle();
  assert.equal(fetcher.mock.callCount(), 1, 'failed requests also have a cooldown');
  b.advance(60_000);
  status = 401;
  b.window.dispatchEvent(new Event('pointerdown'));
  await settle();
  assert.equal(unauthorized.mock.callCount(), 1);
  b.advance(60 * 60 * 1000);
  b.window.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(fetcher.mock.callCount(), 2, '401 stops further renewal attempts');
});

test('only one refresh is in flight and stopping aborts it without handling a late 401', async t => {
  const b = browser(t);
  let complete!: (response: Response) => void;
  const fetcher = t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { complete = resolve; }));
  const unauthorized = t.mock.fn();
  const stop = startSessionRefresh(unauthorized);
  b.onCleanup(stop);
  b.advance(60 * 60 * 1000);
  b.window.dispatchEvent(new Event('focus'));
  assert.equal(fetcher.mock.callCount(), 1);
  const signal = fetcher.mock.calls[0].arguments[1]?.signal;
  assert.ok(signal);
  stop();
  assert.equal(signal.aborted, true);
  complete(new Response(null, { status: 401 }));
  await settle();
  assert.equal(unauthorized.mock.callCount(), 0);
});

test('network errors retry on later activity without signing the user out', async t => {
  const b = browser(t);
  let online = false;
  const fetcher = t.mock.method(globalThis, 'fetch', async () => {
    if (!online) throw new TypeError('Failed to fetch');
    return new Response(null, { status: 204 });
  });
  const unauthorized = t.mock.fn();
  b.onCleanup(startSessionRefresh(unauthorized));
  await settle();
  assert.equal(fetcher.mock.callCount(), 1);
  assert.equal(unauthorized.mock.callCount(), 0);
  online = true;
  b.advance(60_000);
  b.window.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(fetcher.mock.callCount(), 2);
  assert.equal(unauthorized.mock.callCount(), 0);
});
