CREATE TABLE "SchoolLocation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "generalInfo" TEXT,
    "imageUrl" TEXT,
    "entranceLat" DOUBLE PRECISION,
    "entranceLng" DOUBLE PRECISION,
    "parkingLat" DOUBLE PRECISION,
    "parkingLng" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "SchoolLocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchoolLocation_schoolId_id_key" ON "SchoolLocation"("schoolId", "id");
ALTER TABLE "SchoolLocation" ADD CONSTRAINT "SchoolLocation_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Request" ADD COLUMN "locationId" TEXT;
CREATE INDEX "Request_schoolId_locationId_idx" ON "Request"("schoolId", "locationId");
ALTER TABLE "Request" ADD CONSTRAINT "Request_schoolId_locationId_fkey"
    FOREIGN KEY ("schoolId", "locationId") REFERENCES "SchoolLocation"("schoolId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
