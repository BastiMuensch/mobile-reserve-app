-- Existing records remain unknown until explicitly completed by the person or office.
ALTER TABLE "Teacher"
  ADD COLUMN "qualificationType" TEXT,
  ADD COLUMN "canTeachSports" BOOLEAN;

ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_qualificationType_check"
  CHECK ("qualificationType" IN ('TEACHER', 'SUPPORT', 'STUDENT'));
