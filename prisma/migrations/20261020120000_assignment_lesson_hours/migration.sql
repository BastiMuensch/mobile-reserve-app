-- Historical assignments stored only a count. Their occupied lesson slots cannot
-- be reconstructed reliably from timetables that may have changed in the meantime.
ALTER TABLE "Assignment" ADD COLUMN "lessonHours" TEXT;
