import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSemVer, compareSemVer } from '../src/lib/updateCheck';

test('parseSemVer parses valid SemVer strings', () => {
  const v1 = parseSemVer('1.2.3');
  assert.deepEqual(v1, { major: 1, minor: 2, patch: 3, prerelease: [] });

  const v2 = parseSemVer('v2.0.0');
  assert.deepEqual(v2, { major: 2, minor: 0, patch: 0, prerelease: [] });

  const v3 = parseSemVer('1.0.0-beta.1');
  assert.deepEqual(v3, { major: 1, minor: 0, patch: 0, prerelease: ['beta', '1'] });

  const v4 = parseSemVer('1.0.0+20260906');
  assert.deepEqual(v4, { major: 1, minor: 0, patch: 0, prerelease: [] });
});

test('parseSemVer rejects invalid SemVer strings', () => {
  assert.equal(parseSemVer('invalid'), null);
  assert.equal(parseSemVer('1.0'), null);
  assert.equal(parseSemVer('1.0.0.0'), null);
  assert.equal(parseSemVer('01.0.0'), null); // leading zeroes not allowed in SemVer
  assert.equal(parseSemVer('1.0.0-01'), null);
});

test('compareSemVer compares versions correctly', () => {
  // Newer major
  assert.equal(compareSemVer('2.0.0', '1.99.99'), 1);
  assert.equal(compareSemVer('1.99.99', '2.0.0'), -1);

  // Newer minor
  assert.equal(compareSemVer('1.3.0', '1.2.9'), 1);
  assert.equal(compareSemVer('1.2.9', '1.3.0'), -1);

  // Newer patch
  assert.equal(compareSemVer('16.3.4', '16.3.3'), 1);
  assert.equal(compareSemVer('16.3.3', '16.3.4'), -1);

  // Equality
  assert.equal(compareSemVer('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemVer('v1.0.0', '1.0.0'), 0);

  // Prerelease is older than release
  assert.equal(compareSemVer('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compareSemVer('1.0.0-rc.2', '1.0.0-rc.1'), 1);

  // Invalid return null
  assert.equal(compareSemVer('invalid', '1.0.0'), null);
});
