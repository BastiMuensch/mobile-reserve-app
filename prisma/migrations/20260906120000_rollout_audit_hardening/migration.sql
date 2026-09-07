-- Normalize Assignment dates to canonical UTC midnight (via Europe/Berlin local day date)
DO $$
DECLARE
  conflict_count INTEGER;
BEGIN
  -- Normalize Assignment dates
  UPDATE "Assignment"
  SET "date" = (timezone('UTC', "date") AT TIME ZONE 'Europe/Berlin')::date::timestamp;

  -- Normalize Request dates and endDates
  UPDATE "Request"
  SET "date" = (timezone('UTC', "date") AT TIME ZONE 'Europe/Berlin')::date::timestamp;

  UPDATE "Request"
  SET "endDate" = (timezone('UTC', "endDate") AT TIME ZONE 'Europe/Berlin')::date::timestamp
  WHERE "endDate" IS NOT NULL;

  -- Normalize Absence dates
  UPDATE "Absence"
  SET "date" = (timezone('UTC', "date") AT TIME ZONE 'Europe/Berlin')::date::timestamp;

  -- Normalize LeavePeriod startDates and endDates
  UPDATE "LeavePeriod"
  SET "startDate" = (timezone('UTC', "startDate") AT TIME ZONE 'Europe/Berlin')::date::timestamp;

  UPDATE "LeavePeriod"
  SET "endDate" = (timezone('UTC', "endDate") AT TIME ZONE 'Europe/Berlin')::date::timestamp
  WHERE "endDate" IS NOT NULL;

  -- Check if any teacher has more than one active (non-rejected) assignment on the same date
  SELECT COUNT(*) INTO conflict_count
  FROM (
    SELECT "teacherId", "date"
    FROM "Assignment"
    WHERE "status" != 'REJECTED'
    GROUP BY "teacherId", "date"
    HAVING COUNT(*) > 1
  ) conflicts;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot create unique index: % conflict(s) found in Assignment table where teacher has multiple active assignments on the same date. Please resolve conflicts manually before running migration.', conflict_count;
  END IF;
END $$;

-- Partial unique index on Assignment (one active assignment per teacher per canonical date)
CREATE UNIQUE INDEX IF NOT EXISTS "Assignment_teacher_active_date_unique"
ON "Assignment" ("teacherId", "date")
WHERE "status" != 'REJECTED';

-- EmailOutbox: recipients, subject, body and attachments are stored together
-- in payloadEncrypted. Do not add plaintext delivery metadata here.
CREATE TABLE IF NOT EXISTS "EmailOutbox" (
  "id" TEXT NOT NULL,
  "schulamtId" TEXT,
  "payloadEncrypted" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "EmailOutbox_status_leaseExpiresAt_idx" ON "EmailOutbox"("status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "EmailOutbox_schulamtId_idx" ON "EmailOutbox"("schulamtId");
CREATE INDEX IF NOT EXISTS "EmailOutbox_createdAt_idx" ON "EmailOutbox"("createdAt");
