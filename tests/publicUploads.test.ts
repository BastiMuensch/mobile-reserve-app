import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { GET } from '../src/app/uploads/[filename]/route';

const get = (filename: string) => GET(new Request('http://localhost/uploads/test.png'), { params: Promise.resolve({ filename }) });

test('new uploads become readable without restarting, for every supported school image format', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'school-images-'));
  const previousRoot = process.env.PUBLIC_UPLOADS_DIR;
  try {
    process.env.PUBLIC_UPLOADS_DIR = root;
    for (const [extension, type] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp']]) {
      const filename = `${randomUUID()}.${extension}`;
      assert.equal((await get(filename)).status, 404);
      const bytes = Buffer.from(`uploaded ${extension}`);
      await writeFile(path.join(root, filename), bytes);
      const response = await get(filename);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), type);
      assert.equal(response.headers.get('content-length'), String(bytes.length));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
  } finally {
    if (previousRoot === undefined) delete process.env.PUBLIC_UPLOADS_DIR; else process.env.PUBLIC_UPLOADS_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test('public uploads cannot read private files, symlinks, directories or oversized images', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'school-images-'));
  const previousRoot = process.env.PUBLIC_UPLOADS_DIR;
  try {
    const publicRoot = path.join(root, 'public');
    await mkdir(publicRoot);
    process.env.PUBLIC_UPLOADS_DIR = publicRoot;
    await writeFile(path.join(root, 'private.png'), 'private signature');
    await symlink(path.join(root, 'private.png'), path.join(publicRoot, 'linked.png'));
    await mkdir(path.join(publicRoot, 'directory.png'));
    await writeFile(path.join(publicRoot, 'empty.png'), '');
    await writeFile(path.join(publicRoot, 'large.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
    for (const filename of ['../private.png', '..%2fprivate.png', '/private.png', '..\\private.png', 'private.png', 'linked.png', 'directory.png', 'empty.png', 'large.png', 'image.svg', 'script.js']) {
      assert.equal((await get(filename)).status, 404, filename);
    }
  } finally {
    if (previousRoot === undefined) delete process.env.PUBLIC_UPLOADS_DIR; else process.env.PUBLIC_UPLOADS_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
