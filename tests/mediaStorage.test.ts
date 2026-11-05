import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrivateSignaturePath, getPublicUploadPath, getSafeImageFilename, isPrivateSignatureUrl, privateSignatureUrl } from '../src/lib/mediaStorage';

const filename = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png';

test('private signature URLs accept only an exact UUID image filename', () => {
  assert.equal(privateSignatureUrl(filename), `/api/media/${filename}`);
  assert.equal(isPrivateSignatureUrl(`/api/media/${filename}`), true);
  assert.equal(getSafeImageFilename(`/api/media/${filename}`, '/api/media/'), filename);
  assert.equal(getPrivateSignaturePath(`/api/media/${filename}`)?.endsWith(filename), true);
});

test('private signature URLs reject traversal, public URLs and query strings', () => {
  assert.equal(isPrivateSignatureUrl('/api/media/../../secret.png'), false);
  assert.equal(isPrivateSignatureUrl(`/api/media/${filename}?download=1`), false);
  assert.equal(isPrivateSignatureUrl(`/uploads/${filename}`), false);
  assert.equal(getPrivateSignaturePath('/api/media/not-a-uuid.png'), null);
});

test('public upload paths support every uploaded school-image format without widening private signatures', () => {
  for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp']) {
    const image = filename.replace(/png$/, extension);
    assert.equal(getPublicUploadPath(`/uploads/${image}`)?.endsWith(image), true);
    assert.equal(isPrivateSignatureUrl(`/api/media/${image}`), !['gif', 'webp'].includes(extension));
  }
  for (const value of [`/uploads/../${filename}`, `/uploads/${filename}?download=1`, `/uploads/${filename}/other`, '/uploads/invalid.webp']) {
    assert.equal(getPublicUploadPath(value), null);
  }
});
