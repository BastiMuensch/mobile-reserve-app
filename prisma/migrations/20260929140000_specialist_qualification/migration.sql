-- Keep historical values for existing profiles and backups; new forms only allow current choices.
ALTER TABLE "Teacher" DROP CONSTRAINT "Teacher_qualificationType_check";
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_qualificationType_check"
  CHECK ("qualificationType" IN ('TEACHER', 'TEACHER_GS', 'TEACHER_MS', 'SPECIALIST', 'SUPPORT', 'STUDENT'));
