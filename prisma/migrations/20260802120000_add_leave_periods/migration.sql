-- CreateTable
CREATE TABLE "LeavePeriod" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    -- Kein Grund-Feld: Der Grund einer längeren Abwesenheit (Mutterschutz, Erkrankung)
    -- ist ein Gesundheitsdatum nach Art. 9 DSGVO und wird bewusst nicht gespeichert.
    "reportedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeavePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeavePeriod_teacherId_idx" ON "LeavePeriod"("teacherId");

-- CreateIndex
CREATE INDEX "LeavePeriod_startDate_idx" ON "LeavePeriod"("startDate");

-- CreateIndex
CREATE INDEX "LeavePeriod_endDate_idx" ON "LeavePeriod"("endDate");

-- AddForeignKey
ALTER TABLE "LeavePeriod" ADD CONSTRAINT "LeavePeriod_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
