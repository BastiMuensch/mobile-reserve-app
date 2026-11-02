ALTER TABLE "Request"
  ADD COLUMN "requestedSchoolType" TEXT,
  ADD COLUMN "gradeLevel" INTEGER,
  ADD COLUMN "requiredSubject" TEXT;

ALTER TABLE "Request" ADD CONSTRAINT "Request_gradeLevel_check" CHECK ("gradeLevel" IS NULL OR "gradeLevel" BETWEEN 1 AND 10);
ALTER TABLE "Request" ADD CONSTRAINT "Request_requestedSchoolType_check" CHECK ("requestedSchoolType" IS NULL OR "requestedSchoolType" IN ('GRUNDSCHULE', 'MITTELSCHULE'));
