-- Keep the full address for letters, but separate the value used for geocoding.
ALTER TABLE "Teacher" ADD COLUMN "postalCode" TEXT NOT NULL DEFAULT '';

-- Backfill a clearly delimited German postal code where one is present. Rows without
-- an unambiguous five-digit value retain their existing coordinates and are completed
-- manually the next time the profile is edited.
UPDATE "Teacher"
SET "postalCode" = COALESCE(
  (regexp_match("address", '(^|[^0-9])([0-9]{5})([^0-9]|$)'))[2],
  ''
);

CREATE TABLE "PostalCodeGeocode" (
  "postalCode" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'NOMINATIM',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PostalCodeGeocode_pkey" PRIMARY KEY ("postalCode")
);
