-- AlterTable
ALTER TABLE "SchulamtProfile" ADD COLUMN "autoBackupEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoBackupEmail" TEXT;

