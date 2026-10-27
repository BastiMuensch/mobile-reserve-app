ALTER TABLE "School" ADD COLUMN "schoolDistrict" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "schoolDistrict" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "privacyNoticeAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Teacher" ADD COLUMN "privacyNoticeVersion" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "privacyNoticeSnapshot" TEXT;
