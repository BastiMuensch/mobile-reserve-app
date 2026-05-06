-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schoolId" TEXT,
    CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "type" TEXT NOT NULL,
    "generalInfo" TEXT,
    "imageUrl" TEXT,
    "pinLat" REAL,
    "pinLng" REAL,
    "schulamtId" TEXT,
    CONSTRAINT "School_schulamtId_fkey" FOREIGN KEY ("schulamtId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "stammschuleId" TEXT NOT NULL,
    "maxWeeklyHours" INTEGER NOT NULL,
    "isPartTime" BOOLEAN NOT NULL DEFAULT false,
    "schedule" TEXT,
    "qualifications" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "homeLat" REAL NOT NULL,
    "homeLng" REAL NOT NULL,
    "preferredType" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL DEFAULT '2025/2026',
    "userId" TEXT,
    CONSTRAINT "Teacher_stammschuleId_fkey" FOREIGN KEY ("stammschuleId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Teacher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "endDate" DATETIME,
    "priority" TEXT NOT NULL DEFAULT 'ERKRANKUNG',
    "startHour" INTEGER NOT NULL DEFAULT 1,
    "hours" INTEGER NOT NULL,
    "weeklyHours" INTEGER NOT NULL DEFAULT 0,
    "schoolType" TEXT NOT NULL DEFAULT 'GRUNDSCHULE',
    "substitutedTeacher" TEXT,
    "schedule" TEXT,
    "qualifications" TEXT NOT NULL,
    "comments" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Request_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "hours" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "Assignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    CONSTRAINT "Absence_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_schoolId_key" ON "User"("schoolId");
