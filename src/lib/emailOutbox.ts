import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { protectSecret, revealSecret } from './secrets';
import { sendEmailDirect } from './email';
import { isDemoMode } from './demoMode';

const LEASE_MS = 60_000;
const RETRY_BASE_MS = 30_000;
const OUTBOX_BATCH_SIZE = 10;
const GENERIC_DELIVERY_ERROR = 'Zustellung über den konfigurierten Mailserver nicht bestätigt.';
const ENCRYPTION_UNAVAILABLE_ERROR = 'Mail konnte nicht sicher verschlüsselt in die Warteschlange aufgenommen werden.';

type Attachment = { filename: string; content: string; contentType?: string };
type EncryptedEmailPayload = { to: string; subject: string; body: string; attachments?: Attachment[] };
type LeasedOutboxItem = {
  id: string;
  schulamtId: string | null;
  payloadEncrypted: string | null;
  attempts: number;
  maxAttempts: number;
  leaseToken: string | null;
};

export type OutboxPreview = { to: string; subject: string } | null;
export type EmailQueueResult = {
  /** The message was durably accepted into the encrypted outbox. */
  mailQueued: boolean;
  /** SMTP accepted the immediate attempt. A false value can still be queued. */
  mailDelivered: boolean;
};
export type TransactionalEmailInput = {
  to: string;
  subject: string;
  body: string;
  schulamtId?: string;
  attachments?: Attachment[];
};
export type TransactionalEmailResult = {
  queued: boolean;
  outboxId?: string;
  /** Only set when the tenant explicitly disabled mail (mailProvider NONE). */
  warning?: string;
};

function encryptPayload(data: EncryptedEmailPayload): string {
  // protectSecret throws for a missing or invalid key. This is intentional:
  // a queue that cannot encrypt must not degrade to an unencrypted database row.
  const encrypted = protectSecret(JSON.stringify(data));
  if (!encrypted.startsWith('enc:v1:')) throw new Error('Outbox payload was not encrypted.');
  return encrypted;
}

function decryptPayload(raw: string): EncryptedEmailPayload {
  if (!raw.startsWith('enc:v1:')) throw new Error('Unencrypted legacy outbox payload is not processed.');
  const parsed: unknown = JSON.parse(revealSecret(raw));
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid encrypted outbox payload.');
  const payload = parsed as Partial<EncryptedEmailPayload>;
  if (
    typeof payload.to !== 'string' ||
    typeof payload.subject !== 'string' ||
    typeof payload.body !== 'string' ||
    (payload.attachments !== undefined && !Array.isArray(payload.attachments))
  ) {
    throw new Error('Invalid encrypted outbox payload.');
  }
  return payload as EncryptedEmailPayload;
}

/**
 * Adds an encrypted PENDING item to the caller's business transaction. SMTP is
 * intentionally excluded: if this throws, the caller can roll back both the
 * business write and the notification intent together.
 */
export async function enqueueEmailInTransaction(
  tx: Prisma.TransactionClient,
  input: TransactionalEmailInput,
): Promise<TransactionalEmailResult> {
  if (process.env.DEMO_MODE === 'true' || (await tx.systemSetting.findUnique({ where: { id: 'demoMode' } }))?.value === 'true') {
    return { queued: false, warning: 'Der E-Mail-Versand ist in dieser Demo deaktiviert.' };
  }
  const schulamtId = input.schulamtId ?? null;
  if (schulamtId) {
    const profile = await tx.schulamtProfile.findUnique({
      where: { userId: schulamtId },
      select: { mailProvider: true },
    });
    if (profile?.mailProvider === 'NONE') {
      return { queued: false, warning: 'Der E-Mail-Versand ist für dieses Schulamt nicht eingerichtet.' };
    }
  }

  const payloadEncrypted = encryptPayload({
    to: input.to,
    subject: input.subject.replace(/[\r\n]/g, ''),
    body: input.body,
    attachments: input.attachments,
  });
  const outboxItem = await tx.emailOutbox.create({
    data: {
      schulamtId,
      payloadEncrypted,
      status: 'PENDING',
      nextAttemptAt: new Date(),
    },
    select: { id: true },
  });
  return { queued: true, outboxId: outboxItem.id };
}

/** Returns recipient and subject only for an authorized server-side outbox view. */
export function getOutboxPreview(payloadEncrypted: string | null): OutboxPreview {
  if (!payloadEncrypted) return null;
  try {
    const { to, subject } = decryptPayload(payloadEncrypted);
    return { to, subject };
  } catch {
    return null;
  }
}

function safeErrorForStorage(error: unknown): string {
  // SMTP errors often repeat addresses, headers, or message text. The outbox
  // is operational evidence, not an error dump.
  if (error instanceof Error && /encrypt|key|secret/i.test(error.message)) {
    return ENCRYPTION_UNAVAILABLE_ERROR;
  }
  return GENERIC_DELIVERY_ERROR;
}

function retryAt(attempts: number): Date {
  return new Date(Date.now() + Math.pow(2, Math.min(Math.max(attempts, 1), 8)) * RETRY_BASE_MS);
}

async function markLeaseFailure(item: LeasedOutboxItem, error: unknown): Promise<void> {
  const permanentlyFailed = item.attempts >= item.maxAttempts;
  await prisma.emailOutbox.updateMany({
    where: { id: item.id, status: 'SENDING', leaseToken: item.leaseToken },
    data: {
      status: permanentlyFailed ? 'FAILED' : 'PENDING',
      lastError: safeErrorForStorage(error),
      nextAttemptAt: permanentlyFailed ? new Date() : retryAt(item.attempts),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

async function deliverLeasedItem(item: LeasedOutboxItem): Promise<boolean> {
  if (!item.payloadEncrypted || !item.leaseToken) {
    await markLeaseFailure(item, new Error('Missing encrypted payload or lease.'));
    return false;
  }

  let payload: EncryptedEmailPayload;
  try {
    payload = decryptPayload(item.payloadEncrypted);
  } catch (error) {
    await markLeaseFailure(item, error);
    return false;
  }

  try {
    // SMTP is external I/O. Renew at the last possible moment and abandon this
    // attempt if another worker has already reclaimed an expired lease.
    if (!await renewLease(item)) return false;
    const sent = await sendEmailDirect(
      payload.to, payload.subject, payload.body, item.schulamtId ?? undefined, payload.attachments,
    );
    if (!sent) throw new Error('SMTP send returned false');

    // A conditional update prevents a paused, expired worker from overwriting
    // a newer lease after another worker has reclaimed the message.
    const completed = await prisma.emailOutbox.updateMany({
      where: { id: item.id, status: 'SENDING', leaseToken: item.leaseToken },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        payloadEncrypted: null,
        lastError: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    return completed.count === 1;
  } catch (error) {
    await markLeaseFailure(item, error);
    return false;
  }
}

/**
 * Persists an encrypted email and attempts delivery. If SMTP or encryption is
 * unavailable, callers receive false and no plaintext mail data is persisted.
 */
export async function enqueueAndSendEmailWithStatus(
  to: string,
  subject: string,
  body: string,
  schulamtId?: string,
  attachments?: Attachment[],
): Promise<EmailQueueResult> {
  if (await isDemoMode()) return { mailQueued: false, mailDelivered: false };
  const sanitizedSubject = subject.replace(/[\r\n]/g, '');
  let payloadEncrypted: string;
  try {
    payloadEncrypted = encryptPayload({ to, subject: sanitizedSubject, body, attachments });
  } catch (error) {
    console.error('Email was not queued because outbox encryption is unavailable:', error);
    // Keep a PII-free operational record so a Schulamt can see that delivery
    // was impossible instead of losing the signal silently. It cannot be
    // retried because recipient and content were intentionally never stored.
    if (schulamtId) {
      try {
        await prisma.emailOutbox.create({
          data: {
            schulamtId,
            status: 'FAILED',
            lastError: ENCRYPTION_UNAVAILABLE_ERROR,
            nextAttemptAt: new Date(),
          },
        });
      } catch (recordError) {
        console.error('Could not record encrypted outbox configuration failure:', recordError);
      }
    }
    return { mailQueued: false, mailDelivered: false };
  }

  try {
    const leaseToken = randomUUID();
    const outboxItem = await prisma.emailOutbox.create({
      data: {
        schulamtId: schulamtId ?? null,
        payloadEncrypted,
        status: 'SENDING',
        attempts: 1,
        nextAttemptAt: new Date(),
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      },
    });

    let mailDelivered = false;
    try {
      mailDelivered = await deliverLeasedItem({
        id: outboxItem.id,
        schulamtId: outboxItem.schulamtId,
        payloadEncrypted: outboxItem.payloadEncrypted,
        attempts: outboxItem.attempts,
        maxAttempts: outboxItem.maxAttempts,
        leaseToken,
      });
    } catch (error) {
      // The row is already durable. Reporting it as queued is more honest
      // than claiming it vanished when a follow-up status update failed.
      console.error('Persisted email could not be immediately delivered:', error);
    }
    return { mailQueued: true, mailDelivered };
  } catch (error) {
    // A post-commit notification must never turn a successful business action
    // into HTTP 500. The caller gets an explicit undelivered/not-queued result.
    console.error('Email could not be persisted or processed by the outbox:', error);
    return { mailQueued: false, mailDelivered: false };
  }
}

/** Backwards-compatible result for callers that only need immediate delivery. */
export async function enqueueAndSendEmail(
  to: string,
  subject: string,
  body: string,
  schulamtId?: string,
  attachments?: Attachment[],
): Promise<boolean> {
  return (await enqueueAndSendEmailWithStatus(to, subject, body, schulamtId, attachments)).mailDelivered;
}

/**
 * Lists a bounded amount of work without leasing it. Each item is claimed
 * immediately before its SMTP attempt so a slow first message cannot let the
 * leases of the remaining batch expire.
 */
async function findDueOutboxIds(): Promise<string[]> {
  const now = new Date();
  const candidates = await prisma.emailOutbox.findMany({
    where: {
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'SENDING', leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: OUTBOX_BATCH_SIZE,
    select: { id: true },
  });
  return candidates.map((candidate) => candidate.id);
}

/** Atomically acquires one item. A competing worker can only win one lease. */
async function claimOutboxItem(id: string): Promise<LeasedOutboxItem | null> {
  const leaseToken = randomUUID();
  const leaseExpiry = new Date(Date.now() + LEASE_MS);
  const claimed = await prisma.emailOutbox.updateMany({
    where: {
      id,
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        { status: 'SENDING', leaseExpiresAt: { lte: new Date() } },
      ],
    },
    data: {
      status: 'SENDING',
      attempts: { increment: 1 },
      leaseToken,
      leaseExpiresAt: leaseExpiry,
    },
  });
  if (claimed.count !== 1) return null;

  return prisma.emailOutbox.findFirst({
    where: { id, status: 'SENDING', leaseToken },
    select: {
      id: true, schulamtId: true, payloadEncrypted: true, attempts: true,
      maxAttempts: true, leaseToken: true,
    },
  });
}

/** Attempts newly committed messages after their surrounding transaction commits. */
export async function deliverOutboxIds(ids: readonly string[]): Promise<{ attempted: number; delivered: number }> {
  let attempted = 0;
  let delivered = 0;
  for (const id of ids) {
    try {
      const item = await claimOutboxItem(id);
      if (!item) continue;
      attempted += 1;
      if (await deliverLeasedItem(item)) delivered += 1;
    } catch (error) {
      // The PENDING record is durable; the scheduler will retry it. Never let
      // post-commit SMTP work alter a successful business response.
      console.error('Committed outbox email could not be delivered immediately:', error);
    }
  }
  return { attempted, delivered };
}

/** Renew immediately before external I/O; never send after losing the lease. */
async function renewLease(item: LeasedOutboxItem): Promise<boolean> {
  const renewed = await prisma.emailOutbox.updateMany({
    where: { id: item.id, status: 'SENDING', leaseToken: item.leaseToken },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  return renewed.count === 1;
}

/**
 * Keeps claim and delivery adjacent. This is deliberately dependency-injectable
 * so the lease ordering is regression-tested without an SMTP server/database.
 */
export async function processOutboxItemsSequentially<T>(
  candidateIds: readonly string[],
  claim: (id: string) => Promise<T | null>,
  deliver: (item: T) => Promise<boolean>,
): Promise<{ processed: number; sent: number; failed: number }> {
  let processed = 0;
  let sent = 0;
  for (const id of candidateIds) {
    const item = await claim(id);
    if (!item) continue;
    processed += 1;
    if (await deliver(item)) sent += 1;
  }
  return { processed, sent, failed: processed - sent };
}

export async function processOutboxBatch(): Promise<{ processed: number; sent: number; failed: number }> {
  const candidateIds = await findDueOutboxIds();
  return processOutboxItemsSequentially(candidateIds, claimOutboxItem, deliverLeasedItem);
}

/** Deletes terminal, payload-minimized records after 30 days. */
export async function pruneOldOutboxEmails(): Promise<number> {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - 30);
  const result = await prisma.emailOutbox.deleteMany({
    where: { status: { in: ['SENT', 'FAILED'] }, updatedAt: { lt: threshold } },
  });
  return result.count;
}

/** Manually retries a terminally failed email without exposing its content. */
export async function retryOutboxEmail(id: string, schulamtId?: string): Promise<boolean> {
  const result = await prisma.emailOutbox.updateMany({
    where: {
      id,
      status: 'FAILED',
      ...(schulamtId ? { schulamtId } : {}),
      payloadEncrypted: { not: null },
    },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  return result.count === 1;
}
