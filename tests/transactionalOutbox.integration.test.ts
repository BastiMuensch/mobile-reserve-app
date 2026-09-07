import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { enqueueEmailInTransaction } from '../src/lib/emailOutbox';

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('Transactional outbox rollback (Skipped - requires TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL not configured' }, () => {
    assert.ok(true);
  });
} else {
  process.env.SMTP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('a failed business transaction leaves no durable outbox intent', async () => {
    const key = `outbox-rollback-${Date.now()}`;
    const schulamtId = `outbox-tenant-${Date.now()}`;
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.systemSetting.create({ data: { id: key, value: 'business-write' } });
      await enqueueEmailInTransaction(tx, {
        to: 'rollback-test@example.invalid', subject: 'rollback', body: 'must not persist', schulamtId,
      });
      throw new Error('force rollback');
    }));

    assert.equal(await prisma.systemSetting.count({ where: { id: key } }), 0);
    assert.equal(await prisma.emailOutbox.count({ where: { schulamtId } }), 0);
    await prisma.$disconnect();
  });
}
