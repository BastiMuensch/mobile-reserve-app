import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryHtml, recoveryJs } from '../scripts/recovery-ui.mjs';

test('recovery portal keeps CSP-safe assets and exact full-backup magic detection', () => {
  assert.match(recoveryHtml(), /src="\/_recovery\/app\.js" defer/);
  assert.match(recoveryHtml(), /src="\/_recovery\/logo\.png"/);
  assert.match(recoveryJs, /file\.slice\(0, 9\)\.text\(\) !== 'MRBACKUP1'/);
  assert.doesNotMatch(recoveryHtml(), /<script>(?!<\/script>)/);
});

test('recovery status flow preserves active forms and resumes polling after notification release', () => {
  assert.match(recoveryJs, /busy && \(document\.getElementById\('uploadForm'\) \|\| document\.getElementById\('commitForm'\) \|\| document\.getElementById\('resumeForm'\)\)/);
  assert.match(recoveryJs, /showProgress\('Benachrichtigungen und Hintergrundjobs werden wieder freigegeben\.'/);
  assert.match(recoveryJs, /startPolling\(\); await refreshStatus\(\);/);
  assert.match(recoveryJs, /if \(resuming && status\.notificationsPaused === true\) return;/);
});

test('rolled-back generation can still release paused notifications and summary omits absent counters', () => {
  assert.match(recoveryJs, /function showRolledBack\(status\)[\s\S]*status\.notificationsPaused === true/);
  assert.match(recoveryJs, /if \(paused\) bindResumeForm\(\);/);
  assert.match(recoveryJs, /rows\.filter\(\(\[, value\]\) => value !== undefined && value !== null\)/);
  assert.match(recoveryJs, /resuming = false; stopPolling\(\); lastStatusKey = '';/);
});
