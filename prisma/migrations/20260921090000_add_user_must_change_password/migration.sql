-- Existing accounts remain usable. Only newly provisioned or explicitly reset
-- school accounts are marked as requiring a password change by application code.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
