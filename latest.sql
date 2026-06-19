-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schoolId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "generalInfo" TEXT,
    "imageUrl" TEXT,
    "pinLat" DOUBLE PRECISION,
    "pinLng" DOUBLE PRECISION,
    "schulamtId" TEXT,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "stammschuleId" TEXT NOT NULL,
    "maxWeeklyHours" INTEGER NOT NULL,
    "isPartTime" BOOLEAN NOT NULL DEFAULT false,
    "schedule" TEXT,
    "qualifications" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "gender" TEXT,
    "homeLat" DOUBLE PRECISION NOT NULL,
    "homeLng" DOUBLE PRECISION NOT NULL,
    "preferredType" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL DEFAULT '2025/2026',
    "userId" TEXT,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'ERKRANKUNG',
    "startHour" INTEGER NOT NULL DEFAULT 1,
    "hours" INTEGER NOT NULL,
    "weeklyHours" INTEGER NOT NULL DEFAULT 0,
    "schoolType" TEXT NOT NULL DEFAULT 'GRUNDSCHULE',
    "substitutedTeacher" TEXT NOT NULL,
    "schedule" TEXT,
    "qualifications" TEXT NOT NULL,
    "comments" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hours" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchulamtProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headerText" TEXT NOT NULL DEFAULT 'Staatliche Schulämter im Landkreis Unterallgäu und in der Stadt Memmingen',
    "returnAddress" TEXT NOT NULL DEFAULT 'Staatliches Schulamt Unterallgäu - Memminger Str. 18 - 87719 Mindelheim',
    "logoUrl" TEXT,
    "contactAddress" TEXT NOT NULL DEFAULT 'Memminger Str. 18
87719 Mindelheim
Telefon 08261 995 341
Telefax 08261 995 383',
    "contactPerson" TEXT NOT NULL DEFAULT 'Tamara Schmidt
Durchwahl: 08261 995 441
SchA
schulamts@lra.unterallgaeu.de
www.schulamt.mm.unterallgaeu.de',
    "city" TEXT NOT NULL DEFAULT 'Mindelheim',
    "amtsleitungName" TEXT NOT NULL DEFAULT 'Ursula Abt',
    "amtsleitungTitle" TEXT NOT NULL DEFAULT 'Schulamtsdirektorin',
    "signatureUrl" TEXT,
    "smtpHost" TEXT,
    "smtpUser" TEXT,
    "smtpPass" TEXT,

    CONSTRAINT "SchulamtProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_schoolId_key" ON "User"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "School_schulamtId_idx" ON "School"("schulamtId");

-- CreateIndex
CREATE INDEX "Teacher_stammschuleId_idx" ON "Teacher"("stammschuleId");

-- CreateIndex
CREATE INDEX "Teacher_userId_idx" ON "Teacher"("userId");

-- CreateIndex
CREATE INDEX "Teacher_schoolYear_idx" ON "Teacher"("schoolYear");

-- CreateIndex
CREATE INDEX "Request_schoolId_idx" ON "Request"("schoolId");

-- CreateIndex
CREATE INDEX "Assignment_requestId_idx" ON "Assignment"("requestId");

-- CreateIndex
CREATE INDEX "Assignment_teacherId_idx" ON "Assignment"("teacherId");

-- CreateIndex
CREATE INDEX "Assignment_date_idx" ON "Assignment"("date");

-- CreateIndex
CREATE INDEX "Absence_teacherId_idx" ON "Absence"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "SchulamtProfile_userId_key" ON "SchulamtProfile"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_schulamtId_fkey" FOREIGN KEY ("schulamtId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_stammschuleId_fkey" FOREIGN KEY ("stammschuleId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchulamtProfile" ADD CONSTRAINT "SchulamtProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

