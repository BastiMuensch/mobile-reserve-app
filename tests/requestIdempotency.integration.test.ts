import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { requestAttemptFingerprint } from '../src/lib/requestIdempotency';
import { enqueueEmailInTransaction } from '../src/lib/emailOutbox';

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('Request idempotency integration (skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => assert.ok(true));
} else {
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('request idempotency and transactional email enqueue are atomic', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let schoolId: string | undefined;
    let schulamtId: string | undefined;
    const previousEncryptionKey = process.env.SMTP_ENCRYPTION_KEY;
    try {
      const schulamt = await prisma.user.create({ data: { email: `idempotency-${suffix}@test.local`, password: 'hash', role: 'SCHULAMT' } });
      schulamtId = schulamt.id;
      const school = await prisma.school.create({ data: { name: `Idempotenz ${suffix}`, address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId } });
      schoolId = school.id;
      const create = (idempotencyKey: string, comments = 'Gleicher Bedarf') => {
        const attempt = {
          schoolId: school.id, date: new Date('2026-10-01T00:00:00.000Z'), endDate: null,
          priority: 'UNPLANNED_ABSENCE', startHour: 1, hours: 4, weeklyHours: 4,
          schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Testperson', schedule: null,
          qualifications: 'Grundschule', comments, isOpenEnded: false,
        };
        return prisma.request.create({ data: { ...attempt, idempotencyKey, idempotencyFingerprint: requestAttemptFingerprint(attempt), status: 'PENDING' } });
      };
      const retryKey = '550e8400-e29b-41d4-a716-446655440000';
      const concurrent = await Promise.allSettled([create(retryKey), create(retryKey)]);
      assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1);
      await create('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
      assert.equal(await prisma.request.count({ where: { schoolId: school.id } }), 2);

      await prisma.schulamtProfile.create({ data: { userId: schulamt.id, mailProvider: 'SMTP' } });
      const createInTransaction = (tx: Parameters<typeof enqueueEmailInTransaction>[0], idempotencyKey: string) => {
        const attempt = {
          schoolId: school.id, date: new Date('2026-10-02T00:00:00.000Z'), endDate: null,
          priority: 'UNPLANNED_ABSENCE', startHour: 1, hours: 4, weeklyHours: 4,
          schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Testperson', schedule: null,
          qualifications: 'Grundschule', comments: 'Atomarer Mail-Test', isOpenEnded: false,
        };
        return tx.request.create({ data: { ...attempt, idempotencyKey, idempotencyFingerprint: requestAttemptFingerprint(attempt), status: 'PENDING' } });
      };
      const requestCount = () => prisma.request.count({ where: { schoolId: school.id } });
      const outboxCount = () => prisma.emailOutbox.count({ where: { schulamtId: schulamt.id } });

      // Configured mail with no encryption key fails the transaction: neither
      // the demand nor an unencrypted outbox record may survive.
      delete process.env.SMTP_ENCRYPTION_KEY;
      await assert.rejects(prisma.$transaction(async tx => {
        await createInTransaction(tx, '9b2fca7e-5b3a-4877-8a1e-c9d3b9821aa1');
        await enqueueEmailInTransaction(tx, { to: schulamt.email, subject: 'Atomic test', body: 'body', schulamtId: schulamt.id });
      }));
      assert.equal(await requestCount(), 2);
      assert.equal(await outboxCount(), 0);

      // Once encryption is configured, a later domain failure still rolls both
      // writes back. No SMTP delivery is attempted in this test.
      process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
      await assert.rejects(prisma.$transaction(async tx => {
        await createInTransaction(tx, '5c64ca52-2152-4c9e-af18-f5305d4aa7f2');
        const queued = await enqueueEmailInTransaction(tx, { to: schulamt.email, subject: 'Atomic test', body: 'body', schulamtId: schulamt.id });
        assert.equal(queued.queued, true);
        throw new Error('forced rollback');
      }), /forced rollback/);
      assert.equal(await requestCount(), 2);
      assert.equal(await outboxCount(), 0);

      const committed = await prisma.$transaction(async tx => {
        const request = await createInTransaction(tx, 'a183a701-66e4-45d8-a4b7-e97f812a27ca');
        const queued = await enqueueEmailInTransaction(tx, { to: schulamt.email, subject: 'Atomic test', body: 'non-plaintext body', schulamtId: schulamt.id });
        return { request, queued };
      });
      assert.equal(committed.queued.queued, true);
      assert.ok(committed.queued.outboxId);
      const encrypted = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: committed.queued.outboxId } });
      assert.ok(encrypted.payloadEncrypted?.startsWith('enc:v1:'));
      assert.equal(encrypted.payloadEncrypted?.includes('non-plaintext body'), false);
      assert.equal(await requestCount(), 3);
      assert.equal(await outboxCount(), 1);

      // Explicitly disabled tenant mail is an allowed no-op: the request commits
      // and callers receive a warning, but no outbox row is written.
      await prisma.schulamtProfile.update({ where: { userId: schulamt.id }, data: { mailProvider: 'NONE' } });
      delete process.env.SMTP_ENCRYPTION_KEY;
      const disabledMail = await prisma.$transaction(async tx => {
        const request = await createInTransaction(tx, 'd23e38c2-03ed-4a83-84f5-9fd1c06e82dc');
        const queued = await enqueueEmailInTransaction(tx, { to: schulamt.email, subject: 'Atomic test', body: 'body', schulamtId: schulamt.id });
        return { request, queued };
      });
      assert.equal(disabledMail.queued.queued, false);
      assert.match(disabledMail.queued.warning || '', /nicht eingerichtet/);
      assert.equal(await requestCount(), 4);
      assert.equal(await outboxCount(), 1);
    } finally {
      if (previousEncryptionKey === undefined) delete process.env.SMTP_ENCRYPTION_KEY;
      else process.env.SMTP_ENCRYPTION_KEY = previousEncryptionKey;
      if (schoolId) {
        await prisma.request.deleteMany({ where: { schoolId } });
        await prisma.emailOutbox.deleteMany({ where: { schulamtId } });
        await prisma.school.deleteMany({ where: { id: schoolId } });
      }
      if (schulamtId) await prisma.user.deleteMany({ where: { id: schulamtId } });
      await prisma.$disconnect();
    }
  });
}
