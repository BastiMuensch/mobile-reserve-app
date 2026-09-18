CREATE TABLE "ReserveReportingPeriod" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "weeklyHours" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "ReserveReportingPeriod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReserveReportingPeriod_category_check" CHECK ("category" IN ('GS_MS', 'EG', 'MT', 'OTHER')),
    CONSTRAINT "ReserveReportingPeriod_hours_check" CHECK ("weeklyHours" >= 0 AND "weeklyHours" <= 60)
);
CREATE UNIQUE INDEX "ReserveReportingPeriod_teacherId_effectiveFrom_key" ON "ReserveReportingPeriod"("teacherId", "effectiveFrom");
ALTER TABLE "ReserveReportingPeriod" ADD CONSTRAINT "ReserveReportingPeriod_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GovernmentReport" (
    "id" TEXT NOT NULL,
    "schulamtId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GovernmentReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GovernmentReport_schulamtId_date_key" ON "GovernmentReport"("schulamtId", "date");
ALTER TABLE "GovernmentReport" ADD CONSTRAINT "GovernmentReport_schulamtId_fkey" FOREIGN KEY ("schulamtId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
