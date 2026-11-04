-- Office-defined district list (replaces free text in forms once filled) and the
-- opt-in Fachlehrkraft module. All additions are optional and default to the
-- previous behaviour.
ALTER TABLE "SchulamtProfile"
  ADD COLUMN "schoolDistricts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "specialistRequestsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "specialistFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Teacher" ADD COLUMN "specialistFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Request" ADD COLUMN "requestedSpecialistField" TEXT;
ALTER TABLE "Request" DROP CONSTRAINT "Request_requestedSchoolType_check";
ALTER TABLE "Request" ADD CONSTRAINT "Request_requestedSchoolType_check"
  CHECK ("requestedSchoolType" IS NULL OR "requestedSchoolType" IN ('GRUNDSCHULE', 'MITTELSCHULE', 'FACHLEHRKRAFT'));
