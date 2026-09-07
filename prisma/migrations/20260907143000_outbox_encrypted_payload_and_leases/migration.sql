-- Existing rollout-audit deployments may already have the first EmailOutbox
-- table. Remove legacy plaintext mail fields and make legacy queue contents
-- non-deliverable rather than retaining or sending unprotected PII.
ALTER TABLE "EmailOutbox"
  ADD COLUMN IF NOT EXISTS "leaseToken" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

UPDATE "EmailOutbox"
SET
  "payloadEncrypted" = NULL,
  "status" = CASE WHEN "status" = 'SENT' THEN 'SENT' ELSE 'FAILED' END,
  "lastError" = CASE
    WHEN "status" = 'SENT' THEN NULL
    ELSE 'Aus Sicherheitsgründen nach dem Outbox-Upgrade nicht erneut zustellbar.'
  END,
  "leaseToken" = NULL,
  "leaseExpiresAt" = NULL
WHERE "payloadEncrypted" IS NOT NULL OR "status" IN ('PENDING', 'SENDING');

ALTER TABLE "EmailOutbox"
  DROP COLUMN IF EXISTS "to",
  DROP COLUMN IF EXISTS "subject";

CREATE INDEX IF NOT EXISTS "EmailOutbox_status_leaseExpiresAt_idx"
  ON "EmailOutbox"("status", "leaseExpiresAt");
