ALTER TABLE "SchulamtProfile" ADD COLUMN "reserveShortageMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Assignment" ADD COLUMN "cancelledHours" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_cancelledHours_nonnegative" CHECK ("cancelledHours" >= 0);
