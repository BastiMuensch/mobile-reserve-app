ALTER TABLE "SchulamtProfile" DROP COLUMN "autoBackupEnabled";
ALTER TABLE "SchulamtProfile" DROP COLUMN "autoBackupEmail";
ALTER TABLE "SchulamtProfile" ADD COLUMN "lastBackupDate" TIMESTAMP(3);
