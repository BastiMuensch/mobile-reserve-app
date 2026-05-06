/*
  Warnings:

  - Made the column `substitutedTeacher` on table `Request` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "endDate" DATETIME,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Request_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Request" ("comments", "createdAt", "date", "endDate", "hours", "id", "priority", "qualifications", "schedule", "schoolId", "schoolType", "startHour", "status", "substitutedTeacher", "updatedAt", "weeklyHours") SELECT "comments", "createdAt", "date", "endDate", "hours", "id", "priority", "qualifications", "schedule", "schoolId", "schoolType", "startHour", "status", "substitutedTeacher", "updatedAt", "weeklyHours" FROM "Request";
DROP TABLE "Request";
ALTER TABLE "new_Request" RENAME TO "Request";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
