-- Keep legacy TEACHER records readable; require an explicit GS/MS choice on edit.
ALTER TABLE "Teacher" DROP CONSTRAINT "Teacher_qualificationType_check";
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_qualificationType_check"
  CHECK ("qualificationType" IN ('TEACHER', 'TEACHER_GS', 'TEACHER_MS', 'SUPPORT', 'STUDENT'));
