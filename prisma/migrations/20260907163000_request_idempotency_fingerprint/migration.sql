-- Bind each request idempotency key to its normalized, effective payload.
-- Nullable preserves the rows created before this follow-up hardening.
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "idempotencyFingerprint" TEXT;
