import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { GET } from '../src/app/api/backup/recovery/public-media/[filename]/route';

const token = 'r'.repeat(32);
const request = (filename: string, authorized = true) => new Request(`http://internal.invalid/api/backup/recovery/public-media/${filename}`, {
  headers: authorized ? { 'x-recovery-auth-token': token } : {},
});
const context = (filename: string) => ({ params: Promise.resolve({ filename }) });

test('recovery public media keeps baseline uploads reachable when no generation root is set', async () => {
  const previousRoot = process.env.PUBLIC_UPLOADS_DIR, previousToken = process.env.RECOVERY_AUTH_TOKEN;
  const directory = path.join(process.cwd(), 'public/uploads'), filename = `baseline-${randomUUID()}.png`;
  try {
    delete process.env.PUBLIC_UPLOADS_DIR; process.env.RECOVERY_AUTH_TOKEN = token;
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, filename), 'baseline-image');
    const media = await GET(request(filename), context(filename));
    assert.equal(media.status, 200); assert.equal(await media.text(), 'baseline-image');
  } finally {
    await rm(path.join(directory, filename), { force: true });
    if (previousRoot === undefined) delete process.env.PUBLIC_UPLOADS_DIR; else process.env.PUBLIC_UPLOADS_DIR = previousRoot;
    if (previousToken === undefined) delete process.env.RECOVERY_AUTH_TOKEN; else process.env.RECOVERY_AUTH_TOKEN = previousToken;
  }
});

test('recovery public media requires its internal token and rejects symlinks and oversized files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'recovery-public-media-'));
  const previousRoot = process.env.PUBLIC_UPLOADS_DIR, previousToken = process.env.RECOVERY_AUTH_TOKEN;
  try {
    process.env.PUBLIC_UPLOADS_DIR = root; process.env.RECOVERY_AUTH_TOKEN = token;
    assert.equal((await GET(request('photo.png', false), context('photo.png'))).status, 403);
    await writeFile(path.join(root, 'outside.png'), 'not an upload');
    await symlink(path.join(root, 'outside.png'), path.join(root, 'linked.png'));
    assert.equal((await GET(request('linked.png'), context('linked.png'))).status, 404);
    await writeFile(path.join(root, 'large.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
    assert.equal((await GET(request('large.png'), context('large.png'))).status, 404);
    await writeFile(path.join(root, 'valid.png'), 'image');
    const media = await GET(request('valid.png'), context('valid.png'));
    assert.equal(media.status, 200); assert.equal(media.headers.get('content-type'), 'image/png'); assert.equal(await media.text(), 'image');
  } finally {
    if (previousRoot === undefined) delete process.env.PUBLIC_UPLOADS_DIR; else process.env.PUBLIC_UPLOADS_DIR = previousRoot;
    if (previousToken === undefined) delete process.env.RECOVERY_AUTH_TOKEN; else process.env.RECOVERY_AUTH_TOKEN = previousToken;
    await rm(root, { recursive: true, force: true });
  }
});
