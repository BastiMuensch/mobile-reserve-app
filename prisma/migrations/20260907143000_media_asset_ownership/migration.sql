-- Ownership metadata for uploaded files. A profile may only point at an asset
-- uploaded by that school office for the declared purpose.
CREATE TABLE "UploadedAsset" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UploadedAsset_url_key" ON "UploadedAsset"("url");
CREATE INDEX "UploadedAsset_ownerUserId_purpose_idx" ON "UploadedAsset"("ownerUserId", "purpose");

ALTER TABLE "UploadedAsset"
  ADD CONSTRAINT "UploadedAsset_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing profile references were created before ownership metadata existed.
-- They are backfilled only for their owning profile and retain their current
-- URL until the administrator runs the private-signature migration.
INSERT INTO "UploadedAsset" ("id", "ownerUserId", "url", "purpose", "createdAt")
SELECT md5('legacy-profile-asset:' || p."id" || ':' || p."logoUrl"), p."userId", p."logoUrl", 'logo', CURRENT_TIMESTAMP
FROM "SchulamtProfile" p
WHERE p."logoUrl" IS NOT NULL
ON CONFLICT ("url") DO NOTHING;

INSERT INTO "UploadedAsset" ("id", "ownerUserId", "url", "purpose", "createdAt")
SELECT md5('legacy-profile-asset:' || p."id" || ':' || p."signatureUrl"), p."userId", p."signatureUrl", 'signature', CURRENT_TIMESTAMP
FROM "SchulamtProfile" p
WHERE p."signatureUrl" IS NOT NULL
ON CONFLICT ("url") DO NOTHING;
