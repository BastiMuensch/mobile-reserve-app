-- These indexes have long been declared in schema.prisma, but were missing
-- from the migration history. Keep fresh installs and upgraded databases aligned.
CREATE INDEX IF NOT EXISTS "Absence_teacherId_idx" ON "Absence"("teacherId");
CREATE INDEX IF NOT EXISTS "Assignment_requestId_idx" ON "Assignment"("requestId");
CREATE INDEX IF NOT EXISTS "Assignment_teacherId_idx" ON "Assignment"("teacherId");
CREATE INDEX IF NOT EXISTS "Assignment_date_idx" ON "Assignment"("date");
CREATE INDEX IF NOT EXISTS "Request_schoolId_idx" ON "Request"("schoolId");
CREATE INDEX IF NOT EXISTS "School_schulamtId_idx" ON "School"("schulamtId");
CREATE INDEX IF NOT EXISTS "Teacher_stammschuleId_idx" ON "Teacher"("stammschuleId");
CREATE INDEX IF NOT EXISTS "Teacher_userId_idx" ON "Teacher"("userId");
CREATE INDEX IF NOT EXISTS "Teacher_schoolYear_idx" ON "Teacher"("schoolYear");

-- Prisma supplies @updatedAt on every write; match the declared column default.
ALTER TABLE "EmailOutbox" ALTER COLUMN "updatedAt" DROP DEFAULT;
