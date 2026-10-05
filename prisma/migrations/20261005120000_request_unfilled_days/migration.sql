-- Preserve existing whole-request decisions; new decisions apply to a single day.
ALTER TABLE "Request" ADD COLUMN "unfilledDays" TEXT;
