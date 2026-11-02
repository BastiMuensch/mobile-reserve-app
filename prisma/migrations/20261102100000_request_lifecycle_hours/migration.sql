ALTER TABLE "Assignment" ADD COLUMN "actualHours" INTEGER, ADD COLUMN "actualAdditionalMinutes" INTEGER;
CREATE TABLE "RequestLifecycleEvent" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "action" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "lastDay" TIMESTAMP(3), "previousEndDate" TIMESTAMP(3), "wasOpenEnded" BOOLEAN NOT NULL,
  "cancelledAssignments" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequestLifecycleEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RequestLifecycleEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RequestLifecycleEvent_requestId_idx" ON "RequestLifecycleEvent"("requestId");
CREATE TABLE "AssignmentHourCorrection" (
  "id" TEXT NOT NULL, "assignmentId" TEXT NOT NULL, "plannedHours" INTEGER NOT NULL,
  "previousActualHours" INTEGER, "previousAdditionalMinutes" INTEGER, "proposedHours" INTEGER NOT NULL,
  "additionalMinutes" INTEGER NOT NULL DEFAULT 0, "additionalTasks" TEXT, "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "submittedById" TEXT NOT NULL, "reviewedById" TEXT,
  "reviewNote" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "AssignmentHourCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssignmentHourCorrection_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AssignmentHourCorrection_assignmentId_idx" ON "AssignmentHourCorrection"("assignmentId");
CREATE INDEX "AssignmentHourCorrection_status_idx" ON "AssignmentHourCorrection"("status");
CREATE UNIQUE INDEX "AssignmentHourCorrection_one_pending" ON "AssignmentHourCorrection"("assignmentId") WHERE "status" = 'PENDING';
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_actual_hours_nonnegative" CHECK ("actualHours" IS NULL OR "actualHours" BETWEEN 0 AND 24), ADD CONSTRAINT "Assignment_actual_additional_nonnegative" CHECK ("actualAdditionalMinutes" IS NULL OR "actualAdditionalMinutes" BETWEEN 0 AND 1440);
