ALTER TABLE "SchulamtProfile"
  ALTER COLUMN "headerText" SET DEFAULT '',
  ALTER COLUMN "returnAddress" SET DEFAULT '',
  ALTER COLUMN "contactAddress" SET DEFAULT '',
  ALTER COLUMN "contactPerson" SET DEFAULT '',
  ALTER COLUMN "city" SET DEFAULT '',
  ALTER COLUMN "amtsleitungName" SET DEFAULT '',
  ALTER COLUMN "amtsleitungTitle" SET DEFAULT '',
  ADD COLUMN "documentSubject" TEXT NOT NULL DEFAULT 'Verwendung als mobile Reserve innerhalb des Schulamtsbereiches',
  ADD COLUMN "documentIntro" TEXT NOT NULL DEFAULT 'Zur Verwendung als mobile Reserve werden Sie wie folgt eingesetzt:',
  ADD COLUMN "documentLegalText" TEXT NOT NULL DEFAULT E'Umzugskostenvergütung wird nicht zugesagt.\n\nBei einer Abordnung an einen Ort außerhalb des Dienst- oder Wohnortes ohne Zusage der Umzugskostenvergütung erhalten Sie auf Antrag Trennungsgeld (Entschädigung bei täglicher Rückkehr zum Wohnort) nach der BayTGV (Art. 22 Abs. 1 BayRKG i. V. m. § 1 Abs. 1 Nr. 3 BayTGV).\n\nEinem etwaigen Antrag auf Trennungsgeld ist dieses Abordnungsschreiben (ggf. Ablichtung) beizufügen.',
  ADD COLUMN "documentClosing" TEXT NOT NULL DEFAULT 'Mit freundlichen Grüßen',
  ADD COLUMN "mailProvider" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "smtpPort" INTEGER,
  ADD COLUMN "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smtpFromName" TEXT,
  ADD COLUMN "smtpFromAddress" TEXT,
  ADD COLUMN "teacherInviteValidityDays" INTEGER NOT NULL DEFAULT 14;

ALTER TABLE "User"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Bestehende Installationen hatten noch keinen Provider-Schalter. Vollständig
-- konfigurierte Tenant-SMTP-Zugänge müssen nach dem Upgrade weiter versenden.
UPDATE "SchulamtProfile"
SET "mailProvider" = 'SMTP'
WHERE "smtpHost" IS NOT NULL
  AND "smtpUser" IS NOT NULL
  AND "smtpPass" IS NOT NULL;

ALTER TABLE "School"
  ALTER COLUMN "latitude" DROP NOT NULL,
  ALTER COLUMN "longitude" DROP NOT NULL,
  ADD COLUMN "geocodingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "geocodingLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "geocodingError" TEXT;

UPDATE "School"
SET "geocodingStatus" = 'RESOLVED'
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

CREATE TABLE "TeacherInvitation" (
  "id" TEXT NOT NULL,
  "schulamtId" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "activeKey" TEXT,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "TeacherInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherInvitation_activeKey_key" ON "TeacherInvitation"("activeKey");
CREATE UNIQUE INDEX "TeacherInvitation_tokenHash_key" ON "TeacherInvitation"("tokenHash");
CREATE INDEX "TeacherInvitation_schulamtId_recipientEmail_idx" ON "TeacherInvitation"("schulamtId", "recipientEmail");
CREATE INDEX "TeacherInvitation_expiresAt_idx" ON "TeacherInvitation"("expiresAt");

ALTER TABLE "TeacherInvitation"
  ADD CONSTRAINT "TeacherInvitation_schulamtId_fkey"
  FOREIGN KEY ("schulamtId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
