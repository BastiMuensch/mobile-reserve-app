import assert from 'node:assert/strict';
import test from 'node:test';
import packageJson from '../package.json';
import { getReleaseNotice, RELEASE_NOTES, releaseSeenKey, type ReleaseNotes } from '../src/lib/releaseNotes';
import { parseSemVer } from '../src/lib/updateCheck';

const releases: ReleaseNotes[] = [
  { version: '1.0.0', changes: { SCHULAMT: ['Planung verbessert.'], SCHOOL: ['Bedarfe einfacher melden.'], TEACHER: ['Einsatzbeginn verbessert.'] } },
  { version: '1.1.0', changes: { SCHULAMT: ['Interne Auswertung verbessert.'], SCHOOL: [] } },
  { version: '1.2.0', changes: { SCHULAMT: ['Verwaltung verbessert.'], SCHOOL: [], TEACHER: [] } },
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
  assert.deepEqual(getReleaseNotice('1.0.0', 'TEACHER', releases)?.changes, ['Einsatzbeginn verbessert.']);
  assert.equal(getReleaseNotice('1.1.0', 'TEACHER', releases), null, 'Historical releases need no invented mobile changes.');
  assert.equal(getReleaseNotice('1.2.0', 'TEACHER', releases), null);
  assert.equal(getReleaseNotice('1.0.0', 'ADMIN', releases), null);
  assert.deepEqual(getReleaseNotice('1.1.0', 'SCHULAMT', releases)?.changes, ['Interne Auswertung verbessert.']);
});

test('unknown versions never show changes from a different release', () => {
  for (const version of ['0.9.0', '1.0.1', '2.0.0', 'invalid']) {
    for (const role of ['SCHULAMT', 'SCHOOL', 'TEACHER']) assert.equal(getReleaseNotice(version, role, releases), null);
  }
});

test('0.1.39 repeats all 0.1.38 topics for each audience and adds school assignment details', () => {
  const previous = RELEASE_NOTES.find(release => release.version === '0.1.38')!.changes;
  const current = RELEASE_NOTES.find(release => release.version === '0.1.39')!.changes;
  assert.deepEqual(current.SCHOOL.slice(0, 3), previous.SCHOOL);
  assert.match(current.SCHOOL[3], /konkreten Unterrichtsstunden.*Telefon- und E-Mail-Links/);
  assert.deepEqual(current.TEACHER, previous.TEACHER);
  assert.equal(current.TEACHER?.length, 4);
  for (const index of [0, 2, 3]) assert.equal(current.SCHULAMT[index], previous.SCHULAMT[index]);
  const assignmentChanges = current.SCHULAMT[1];
  for (const topic of [/speichern.*Unterrichtsstunden/, /Teilbesetzungen.*richtigen Beginn/, /älteren Einsätzen.*Abstimmung/, /Schulen.*Einsatzstunden.*Telefon- und E-Mail-Links/]) {
    assert.match(assignmentChanges, topic);
  }
  for (const version of ['0.1.38', '0.1.39']) {
    const mobile = getReleaseNotice(version, 'TEACHER')!.changes.join(' ');
    for (const topic of [/Unterrichtsstunden/, /Teilbesetzungen/, /älteren Einsätzen/, /Anmeldung/, /langsamen Verbindungen/, /Tageswechsel/, /ganztägige Termine/]) assert.match(mobile, topic);
    assert.doesNotMatch(mobile, /Idealbesetzung|Dringlichkeit|Schulamts-Einstellungen/);
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
  assert.notEqual(releaseSeenKey('teacher-a', '0.1.38'), releaseSeenKey('teacher-a', '0.1.39'));
  assert.notEqual(releaseSeenKey('teacher-a', '0.1.39'), releaseSeenKey('teacher-b', '0.1.39'));
});
