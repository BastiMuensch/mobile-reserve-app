import assert from 'node:assert/strict';
import test from 'node:test';
import packageJson from '../package.json';
import { getReleaseNotice, RELEASE_NOTES, releaseSeenKey, type ReleaseNotes } from '../src/lib/releaseNotes';
import { parseSemVer } from '../src/lib/updateCheck';

const releases: ReleaseNotes[] = [
  { version: '1.0.0', changes: { SCHULAMT: ['Planung verbessert.'], SCHOOL: ['Bedarfe einfacher melden.'] } },
  { version: '1.1.0', changes: { SCHULAMT: ['Interne Auswertung verbessert.'], SCHOOL: [] } },
];

test('every packaged version has concise, explicitly targeted release notes', () => {
  assert.ok(RELEASE_NOTES.some(release => release.version === packageJson.version), 'Add release notes with every package version bump.');
  assert.equal(new Set(RELEASE_NOTES.map(release => release.version)).size, RELEASE_NOTES.length);
  for (const release of RELEASE_NOTES) {
    const parsed = parseSemVer(release.version);
    assert.ok(parsed && !parsed.prerelease.length);
    assert.ok(release.changes.SCHULAMT.length > 0, 'Every release informs the Schulamt.');
    for (const changes of Object.values(release.changes)) {
      assert.ok(changes.length <= 4, 'Keep the notice short.');
      for (const change of changes) assert.ok(change.trim().length > 0 && change.length <= 300);
    }
  }
});

test('each audience sees only its own changes for the installed version', () => {
  assert.deepEqual(getReleaseNotice('1.0.0', 'SCHULAMT', releases)?.changes, ['Planung verbessert.']);
  assert.deepEqual(getReleaseNotice('1.0.0', 'SCHOOL', releases)?.changes, ['Bedarfe einfacher melden.']);
  assert.equal(getReleaseNotice('1.1.0', 'SCHOOL', releases), null);
  assert.equal(getReleaseNotice('1.0.0', 'TEACHER', releases), null);
  assert.equal(getReleaseNotice('1.0.0', 'ADMIN', releases), null);
  assert.deepEqual(getReleaseNotice('1.1.0', 'SCHULAMT', releases)?.changes, ['Interne Auswertung verbessert.']);
});

test('unknown versions never show changes from a different release', () => {
  for (const version of ['0.9.0', '1.0.1', '2.0.0', 'invalid']) {
    assert.equal(getReleaseNotice(version, 'SCHULAMT', releases), null);
  }
});

test('version tags normalize while prerelease and build versions stay visible', () => {
  assert.equal(getReleaseNotice(' v1.0.0 ', 'SCHOOL', releases)?.version, '1.0.0');
  for (const version of ['1.0.0-rc.1', '1.0.0-dev.abc123', '1.0.0+build.1']) {
    assert.equal(getReleaseNotice(version, 'SCHOOL', releases)?.version, version);
    assert.deepEqual(getReleaseNotice(version, 'SCHOOL', releases)?.changes, ['Bedarfe einfacher melden.']);
  }
});

test('acknowledgements are isolated by account and exact installed version', () => {
  assert.notEqual(releaseSeenKey('school-a', '1.0.0'), releaseSeenKey('school-b', '1.0.0'));
  assert.notEqual(releaseSeenKey('school-a', '1.0.0'), releaseSeenKey('school-a', '1.1.0'));
  assert.notEqual(releaseSeenKey('school-a', '1.0.0'), releaseSeenKey('school-a', '1.0.0-rc.1'));
});
