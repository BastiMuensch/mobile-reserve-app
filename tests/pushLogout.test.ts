import test from 'node:test';
import assert from 'node:assert/strict';
import { revokePushSubscription, privatePushPayload } from '../src/lib/pushLogout';
test('offline server revocation still attempts local unsubscribe', async () => {
  let local = false;
  assert.equal(await revokePushSubscription({ endpoint: 'test', unsubscribe: async () => { local = true; return true; } }, async () => { throw new Error('offline'); }), false);
  assert.equal(local, true);
});
test('local unsubscribe failure does not skip server revocation', async () => {
  let server = false;
  assert.equal(await revokePushSubscription({ endpoint: 'test', unsubscribe: async () => { throw new Error('local'); } }, async () => { server = true; return true; }), false);
  assert.equal(server, true);
});
test('lock-screen push does not disclose school or teacher identity', () => {
  assert.deepEqual(Object.keys(privatePushPayload()), ['title', 'body']);
  assert.match(privatePushPayload().body, /öffnen Sie die App/);
});
