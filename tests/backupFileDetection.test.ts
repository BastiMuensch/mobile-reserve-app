import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBackupFile } from '../src/lib/backupFileDetection';

test('backup recognition uses content rather than filename or MIME type', async () => {
  const full = new File(['MRBACKUP1', new Uint8Array(60)], 'renamed.json', { type: 'application/json' });
  assert.equal(await detectBackupFile(full), 'full');
  for (const version of ['1.0', '2.0']) {
    assert.equal(await detectBackupFile(new File([JSON.stringify({ version, data: {} })], 'renamed.mrbackup')), 'legacy');
  }
});

test('backup recognition rejects unsupported, empty, truncated and oversized files', async () => {
  for (const content of ['', 'MRBACKUP1', 'not JSON', '{}', '{"version":"3.0","data":{}}', '{"version":"2.0","data":[]}', '{"version":"2.0","data":null}']) {
    await assert.rejects(detectBackupFile(new Blob([content])));
  }
  // Size guard must fire before any file read, without allocating 192 MiB.
  await assert.rejects(detectBackupFile({ size: 193 * 1024 * 1024, slice() { throw Error('should not read'); } } as unknown as Blob), /zu groß/);
});
