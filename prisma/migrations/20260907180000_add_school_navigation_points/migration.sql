-- Keep the historical pin deliberately unclassified. Existing rows are not
-- backfilled: an old pin might describe either an entrance or a parking spot.
ALTER TABLE "School" ADD COLUMN "entranceLat" DOUBLE PRECISION;
ALTER TABLE "School" ADD COLUMN "entranceLng" DOUBLE PRECISION;
ALTER TABLE "School" ADD COLUMN "parkingLat" DOUBLE PRECISION;
ALTER TABLE "School" ADD COLUMN "parkingLng" DOUBLE PRECISION;
