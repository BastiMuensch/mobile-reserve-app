import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { ARCHIVE_MAX_FILES, encryptSchoolYearArchive } from '../src/lib/schoolYearArchiveZip';

test('archive uses AES-256 ZIP and conceals personal filenames inside one encrypted neutral entry', async () => {
  const password = randomBytes(24).toString('base64url');
  const files = [{ path: 'Einsatznachweise/Anna_Muster/id.pdf', data: Buffer.from('%PDF-test-private') },
    { path: 'Inhaltsverzeichnis.html', data: Buffer.from('<p>Anna Muster</p>') }];
  const encrypted = await encryptSchoolYearArchive(files, password);
  const another = await encryptSchoolYearArchive(files, password);
  assert.notDeepEqual(encrypted, another);
  const raw = Buffer.from(encrypted);
  for (const secret of ['Anna', '%PDF-test-private', 'Einsatznachweise', password]) assert.equal(raw.includes(Buffer.from(secret)), false);
  const reader = new ZipReader(new Uint8ArrayReader(encrypted), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries();
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.equal(entry.filename, 'Archivinhalt.zip');
    assert.equal(entry.encrypted, true);
    assert.equal(entry.extraFieldAES?.strength, 3);
    assert.equal(entry.directory, false);
    if (entry.directory) throw new Error('Unexpected directory');
    assert.ok(entry.getData);
    await assert.rejects(entry.getData!(new Uint8ArrayWriter(), { password: 'wrong', checkSignature: true }));
    const innerBytes = await entry.getData!(new Uint8ArrayWriter(), { password, checkSignature: true });
    const inner = new ZipReader(new Uint8ArrayReader(innerBytes), { useWebWorkers: false });
    try {
      const actual = await inner.getEntries();
      assert.deepEqual(actual.map(e => e.filename), files.map(e => e.path));
      for (const [index, file] of actual.entries()) {
        if (file.directory) throw new Error('Unexpected directory');
        assert.deepEqual(Buffer.from(await file.getData!(new Uint8ArrayWriter(), { checkSignature: true })), files[index].data);
      }
    } finally { await inner.close(); }
  } finally { await reader.close(); }

  // Flip a ciphertext byte, not a filename/directory byte; AES authentication
  // must reject the archive instead of returning a corrupted cleartext ZIP.
  const corrupted = Buffer.from(raw);
  const start = 30 + corrupted.readUInt16LE(26) + corrupted.readUInt16LE(28);
  corrupted[start + 25] ^= 1;
  const corruptReader = new ZipReader(new Uint8ArrayReader(corrupted), { useWebWorkers: false });
  try {
    const [entry] = await corruptReader.getEntries();
    if (entry.directory) throw new Error('Unexpected directory');
    await assert.rejects(entry.getData!(new Uint8ArrayWriter(), { password, checkSignature: true }));
  } finally { await corruptReader.close(); }
});

test('archive rejects unsafe, duplicate, colliding paths, weak passwords and excess file counts', async () => {
  const password = randomBytes(24).toString('base64url');
  const file = (path: string) => ({ path, data: new Uint8Array() });
  for (const name of ['/etc/passwd', '../a', 'A/../b', 'a\\b', 'C:foo', 'a//b', 'a\nb', 'a./b', 'a /b']) {
    await assert.rejects(encryptSchoolYearArchive([file(name)], password), /ARCHIVE_PATH/);
  }
  for (const names of [['A.pdf', 'a.pdf'], ['a', 'a/file'], ['ä.pdf', 'a\u0308.pdf']]) {
    await assert.rejects(encryptSchoolYearArchive(names.map(file), password), /ARCHIVE_PATH/);
  }
  await assert.rejects(encryptSchoolYearArchive([file('a')], 'short'), /ARCHIVE_PASSWORD/);
  await assert.rejects(encryptSchoolYearArchive([], password), /ARCHIVE_LIMIT/);
  await assert.rejects(encryptSchoolYearArchive(Array.from({ length: ARCHIVE_MAX_FILES + 1 }, (_, i) => file(`${i}.pdf`)), password), /ARCHIVE_LIMIT/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(encryptSchoolYearArchive([file('a')], password, controller.signal), /abort/i);
});
