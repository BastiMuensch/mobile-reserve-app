import test from 'node:test';
import assert from 'node:assert/strict';
import { createSafePushLookup, isPublicIpAddress, parsePushEndpoint } from '../src/lib/pushEndpoint';
import type { LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';

function resolvePush(lookup: LookupFunction, options: LookupOptions) {
  return new Promise<{ address: unknown; family: number | undefined }>((resolve, reject) => {
    lookup('push.example.net', options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

test('push DNS supports Node family autoselection as well as single-address callers', async () => {
  const lookup = createSafePushLookup(async () => [
    { address: '8.8.8.8' }, { address: '2001:4860:4860::8888' },
  ]);
  const all = await resolvePush(lookup, { all: true });
  assert.deepEqual(all.address, [
    { address: '8.8.8.8', family: 4 }, { address: '2001:4860:4860::8888', family: 6 },
  ]);
  assert.deepEqual(await resolvePush(lookup, { family: 6 }), { address: '2001:4860:4860::8888', family: 6 });
  assert.deepEqual(await resolvePush(lookup, {}), { address: '8.8.8.8', family: 4 });
});

test('push DNS rejects mixed public/private answers, lookup failures and missing families', async () => {
  for (const records of [[], [{ address: '127.0.0.1' }], [{ address: '8.8.8.8' }, { address: '10.0.0.1' }]]) {
    await assert.rejects(resolvePush(createSafePushLookup(async () => records), { all: true }), /non-public/);
  }
  await assert.rejects(resolvePush(createSafePushLookup(async () => [{ address: '8.8.8.8' }]), { family: 6 }), /requested IP family/);
  await assert.rejects(resolvePush(createSafePushLookup(async () => { throw new Error('DNS unavailable'); }), {}), /DNS unavailable/);
});

test('push endpoint parser accepts generic public HTTPS endpoints', () => {
  const endpoint = parsePushEndpoint('https://push.example.net/wpush/v2/a-token');
  assert.equal(endpoint?.hostname, 'push.example.net');
  assert.equal(parsePushEndpoint('https://fcm.googleapis.com/fcm/send/token')?.protocol, 'https:');
});

test('push endpoint parser rejects unsafe schemes, credentials and local destinations', () => {
  assert.equal(parsePushEndpoint('http://push.example.net/token'), null);
  assert.equal(parsePushEndpoint('https://user:pass@push.example.net/token'), null);
  assert.equal(parsePushEndpoint('https://localhost/token'), null);
  assert.equal(parsePushEndpoint('https://service.local/token'), null);
  assert.equal(parsePushEndpoint('https://127.0.0.1/token'), null);
  assert.equal(parsePushEndpoint('https://[::1]/token'), null);
  assert.equal(parsePushEndpoint('https://push.example.net:8443/token'), null);
});

test('public IP check excludes private, reserved, mapped and documentation ranges', () => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.0.2.1', '192.168.0.1', '198.18.0.1', '198.51.100.7',
    '203.0.113.8', '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:7f00:1',
    '100::1', '2001::1', '2001:db8::1', '2002::1', 'fe80::1', 'fec0::1', 'fd00::1', 'ff02::1',
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2001:4860:4860::8888'), true);
});
