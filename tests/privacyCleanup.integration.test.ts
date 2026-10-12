import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  test('complete privacy cleanup', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(url).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = url;
  test('cron clears expired free text and files, retains operational data, and retries failed file deletion', async t => {
    const { prisma: db } = await import('../src/lib/prisma');
    const { GET } = await import('../src/app/api/cron/cleanup/route');
    const { removePrivateSignature } = await import('../src/lib/mediaStorage');
    const { activeUnfilledDays } = await import('../src/lib/unfilledDays');
    const directory = await mkdtemp(path.join(tmpdir(), 'privacy-cleanup-test-'));
    const oldPublic = process.env.PUBLIC_UPLOADS_DIR;
    const oldPrivate = process.env.PRIVATE_UPLOADS_DIR;
    const oldSecret = process.env.CRON_SECRET;
    process.env.PUBLIC_UPLOADS_DIR = directory;
    process.env.PRIVATE_UPLOADS_DIR = directory;
    process.env.CRON_SECRET = randomUUID();
    const office = await db.user.create({ data: { email: `${randomUUID()}@cleanup.test`, password: 'test', role: 'SCHULAMT' } });
    const school = await db.school.create({ data: { name: 'Cleanup test', address: 'Test', type: 'GRUNDSCHULE', schulamtId: office.id } });
    t.after(async () => {
      await db.request.deleteMany({ where: { schoolId: school.id } });
      await db.emailOutbox.deleteMany({ where: { schulamtId: office.id } });
      await db.schoolLocation.deleteMany({ where: { schoolId: school.id } });
      await db.school.delete({ where: { id: school.id } });
      await db.user.delete({ where: { id: office.id } });
      await db.$disconnect();
      await rm(directory, { recursive: true, force: true });
      for (const [key, value] of [['PUBLIC_UPLOADS_DIR', oldPublic], ['PRIVATE_UPLOADS_DIR', oldPrivate], ['CRON_SECRET', oldSecret]]) {
        if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
      }
    });
    const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);
    const history = [{ date: '2020-01-02', reason: 'Private text', decidedAt: '2020-01-01T12:00:00Z' },
      { date: '2020-01-03', reason: 'Reverted private text', decidedAt: '2020-01-01T12:00:00Z', revertedAt: '2020-01-02T12:00:00Z' }];
    const fields = { schoolId: school.id, date: daysAgo(40), hours: 4, substitutedTeacher: 'Person', comments: 'Private text', className: '3a',
      urgencyNote: 'Private urgency', unfilledReason: 'Legacy private text', unfilledDays: JSON.stringify(history), idempotencyFingerprint: 'old-personal-hash', qualifications: 'Grundschule', status: 'PENDING' };
    const expired = await db.request.create({ data: fields });
    const ongoing = await db.request.create({ data: { ...fields, isOpenEnded: true } });
    const recent = await db.request.create({ data: { ...fields, date: daysAgo(5) } });
    const futureEnd = await db.request.create({ data: { ...fields, endDate: daysAgo(-5) } });
    const ended = await db.request.create({ data: { ...fields, isOpenEnded: true, endedAt: daysAgo(40) } });
    const expiredMail = await db.emailOutbox.create({ data: { schulamtId: office.id, status: 'FAILED', updatedAt: daysAgo(40), payloadEncrypted: 'test' } });
    const openMail = await db.emailOutbox.create({ data: { schulamtId: office.id, status: 'PENDING', updatedAt: daysAgo(40), payloadEncrypted: 'test' } });
    // More than one page of references must not starve a later orphan forever.
    const references = Array.from({ length: 201 }, (_, i) => ({ id: `a-${String(i).padStart(4, '0')}-${randomUUID()}`, url: `/uploads/${randomUUID()}.png` }));
    await db.uploadedAsset.createMany({ data: references.map(asset => ({ ...asset, ownerUserId: office.id, purpose: 'school_image', createdAt: daysAgo(10) })) });
    await db.schoolLocation.createMany({ data: references.map((asset, i) => ({ schoolId: school.id, name: `Site ${i}`, address: 'Test', imageUrl: asset.url })) });
    const filename = `${randomUUID()}.png`;
    await writeFile(path.join(directory, filename), 'orphan');
    const orphan = await db.uploadedAsset.create({ data: { id: `z-${randomUUID()}`, ownerUserId: office.id, url: `/uploads/${filename}`, purpose: 'school_image', createdAt: daysAgo(10) } });
    const freshName = `${randomUUID()}.png`;
    await writeFile(path.join(directory, freshName), 'fresh');
    const fresh = await db.uploadedAsset.create({ data: { ownerUserId: office.id, url: `/uploads/${freshName}`, purpose: 'school_image' } });
    const run = (authorized = true) => GET(new Request('http://localhost/api/cron/cleanup', { headers: { authorization: `Bearer ${authorized ? process.env.CRON_SECRET : 'invalid'}` } }));
    assert.equal((await run(false)).status, 401);
    assert.ok(await db.uploadedAsset.findUnique({ where: { id: orphan.id } }));
    const response = await run();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.stats.clearedClassNames, 2);
    assert.equal(result.stats.clearedUrgencyNotes, 2);
    assert.equal(result.stats.clearedUnfilledReasons, 6);
    assert.equal(result.stats.deletedUploadedAssets, 1);
    assert.equal(result.stats.deletedOutboxEmails, 1);
    for (const request of [expired, ended]) {
      const saved = await db.request.findUniqueOrThrow({ where: { id: request.id } });
      for (const key of ['className', 'urgencyNote', 'unfilledReason', 'idempotencyFingerprint'] as const) assert.equal(saved[key], null);
      assert.equal(saved.substitutedTeacher, '*** gelöscht (DSGVO) ***');
      assert.equal(saved.hours, 4);
      assert.deepEqual(JSON.parse(saved.unfilledDays!), history.map(day => ({ ...day, reason: null })));
      assert.deepEqual(activeUnfilledDays(saved.unfilledDays).map(day => day.date), ['2020-01-02']);
    }
    for (const request of [ongoing, recent, futureEnd]) {
      const saved = await db.request.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(saved.className, '3a');
      assert.equal(saved.urgencyNote, 'Private urgency');
      assert.equal(saved.unfilledDays, JSON.stringify(history));
    }
    assert.equal(await db.emailOutbox.findUnique({ where: { id: expiredMail.id } }), null);
    assert.ok(await db.emailOutbox.findUnique({ where: { id: openMail.id } }));
    await assert.rejects(access(path.join(directory, filename)));
    await access(path.join(directory, freshName));
    assert.ok(await db.uploadedAsset.findUnique({ where: { id: fresh.id } }));
    assert.equal(await db.uploadedAsset.count({ where: { id: { in: references.map(asset => asset.id) } } }), 201);
    const second = await (await run()).json();
    assert.equal(second.stats.clearedClassNames, 0);
    assert.equal(second.stats.clearedUnfilledReasons, 0);
    assert.equal(second.stats.deletedUploadedAssets, 0);
    const marker = await db.systemSetting.findUniqueOrThrow({ where: { id: 'lastGdprCleanup' } });
    // A directory at the file path reliably provokes a filesystem error, even
    // when tests run with permissions that would bypass chmod-based fixtures.
    const blockedName = `${randomUUID()}.png`;
    await mkdir(path.join(directory, blockedName));
    const blocked = await db.uploadedAsset.create({ data: { ownerUserId: office.id, url: `/api/media/${blockedName}`, purpose: 'signature', createdAt: daysAgo(10) } });
    assert.equal(await removePrivateSignature(`/api/media/${blockedName}`), false, 'replacement must retain metadata when unlink fails');
    assert.equal((await run()).status, 500);
    assert.ok(await db.uploadedAsset.findUnique({ where: { id: blocked.id } }));
    assert.equal((await db.systemSetting.findUniqueOrThrow({ where: { id: marker.id } })).value, marker.value);
    await rm(path.join(directory, blockedName), { recursive: true });
    assert.equal((await run()).status, 200, 'missing file is already deleted and permits metadata cleanup');
    assert.equal(await db.uploadedAsset.findUnique({ where: { id: blocked.id } }), null);
  });
}
