import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, copyFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { listUploadFiles, replaceDemoData } from './demo-seed.mjs';
import { isDemoMode } from '../src/lib/demoMode.ts';
import { sendEmailDirect } from '../src/lib/email.ts';
import { enqueueAndSendEmailWithStatus, enqueueEmailInTransaction } from '../src/lib/emailOutbox.ts';
import { sendPushNotification } from '../src/lib/push.ts';
import { prisma } from '../src/lib/prisma.ts';

const url = new URL(process.env.TEST_DATABASE_URL);
assert.match(url.pathname, /_test_demo_/);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: url.href });
const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'reserve-demo-check-')));
const source = path.resolve('scripts/demo-seed.mjs');
const seedPath = path.resolve('output/demo-sonnenhain-2026-09-14/demo-seed.json');
const seed = JSON.parse(await readFile(seedPath));
const env = { ...process.env, DATABASE_URL: url.href };
const run = args => execFileSync(process.execPath, [source, '--seed', seedPath, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const existing = await db.user.findMany({ select: { id: true } });
  assert.ok(existing.length === 0 || (existing.length === 1 && existing[0].id === 'legacy-demo-fixture'), 'Requires fresh test DB or only this test fixture after a preflight abort');
  if (!existing.length) await db.user.create({ data: { id: 'legacy-demo-fixture', name: 'Nur Testbestand', role: 'SCHULAMT', email: 'legacy@example.invalid', password: 'not-a-real-password', schulamtProfile: { create: { headerText: 'Nur Test', mailProvider: 'SMTP', smtpHost: 'invalid.example', smtpPass: 'synthetic-secret' } } } });
  for (const relative of ['public/uploads', 'private-uploads/signatures']) {
    await mkdir(path.join(cwd, relative), { recursive: true });
    await writeFile(path.join(cwd, relative, 'test-fixture.txt'), 'synthetic legacy asset');
  }
  await db.$disconnect();
  const preview = run([]);
  const confirmation = JSON.parse(preview.slice(0, preview.lastIndexOf('}') + 1)).bestaetigung;
  assert.throws(() => run(['--apply', 'WRONG', '--backup-dir', path.join(cwd, 'wrong')]));
  assert.equal(await db.user.count(), 1);
  await db.$disconnect();
  const backup = path.join(cwd, 'recovery');
  run(['--apply', confirmation, '--backup-dir', backup]);
  assert.equal(await db.user.count(), 19);
  assert.equal(await db.user.count({ where: { id: 'legacy-demo-fixture' } }), 0);
  assert.equal(await db.request.count(), 25);
  assert.equal(await db.assignment.count({ where: { status: 'REJECTED' } }), 0);
  assert.equal((await db.schulamtProfile.findFirst()).smtpPass, null);
  assert.equal((await listUploadFiles(path.join(cwd, 'public/uploads'))).length, 0);
  assert.equal((await listUploadFiles(path.join(cwd, 'private-uploads'))).length, 0);
  await access(path.join(backup, 'ERFOLGREICH.txt'));
  const before = await db.user.findMany({ select: { id: true, sessionVersion: true } });
  const broken = structuredClone(seed);
  broken.data.teacher[0].stammschuleId = 'missing-school';
  await assert.rejects(db.$transaction(tx => replaceDemoData(tx, broken)));
  assert.equal(await db.user.count(), 19, 'Failure rolls back all table replacements');
  await db.$transaction(tx => replaceDemoData(tx, seed));
  const after = await db.user.findMany({ select: { id: true, sessionVersion: true } });
  assert.ok(after.every(row => row.sessionVersion !== before.find(old => old.id === row.id).sessionVersion));
  assert.equal(await isDemoMode(), true);
  assert.equal(await sendEmailDirect('nobody@example.invalid', 'demo', 'test'), false);
  assert.deepEqual(await enqueueAndSendEmailWithStatus('nobody@example.invalid', 'demo', 'test'), { mailQueued: false, mailDelivered: false });
  assert.equal((await db.$transaction(tx => enqueueEmailInTransaction(tx, { to: 'nobody@example.invalid', subject: 'demo', body: 'test' }))).queued, false);
  await sendPushNotification(seed.data.user[7].id, { title: 'Demo', body: 'Test' });
  assert.equal(await db.emailOutbox.count(), 0);
  assert.equal(await db.systemSetting.count({ where: { id: 'vapidPrivateKey' } }), 0);
  await prisma.$disconnect();
  await db.$disconnect();
  // Actually restore the dump; pg_restore --list alone is not a restore test.
  execFileSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--dbname', url.href, path.join(backup, 'database.dump')], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(await db.user.count(), 1);
  assert.equal((await db.schulamtProfile.findFirst()).smtpPass, 'synthetic-secret');
  assert.equal(await db.request.count(), 0);
  for (const [index, root] of ['public/uploads', 'private-uploads'].entries()) {
    const relative = index === 0 ? 'test-fixture.txt' : 'signatures/test-fixture.txt';
    await copyFile(path.join(backup, `uploads-${index}`, relative), path.join(cwd, root, relative));
    assert.equal(await readFile(path.join(cwd, root, relative), 'utf8'), 'synthetic legacy asset');
  }
  await db.$disconnect();
  run(['--apply', confirmation, '--backup-dir', path.join(cwd, 'recovery-2')]);
  console.log(`Demo checks passed: confirmation, full backup/restore, asset removal, rollback, session invalidation and mail/push suppression. Test files: ${cwd}`);
} finally { await db.$disconnect(); await prisma.$disconnect(); }
