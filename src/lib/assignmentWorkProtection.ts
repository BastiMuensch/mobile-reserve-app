import type { Prisma } from '@prisma/client';
import { unperformedAssignmentWhere } from './assignmentHours';
import { toCanonicalUtcDate } from './dateKey';
import { recalculateRequestStatus } from './leaveService';
import { lifecycleEventCancelsAssignment } from './requestLifecycle';

/** A pending report temporarily protects work. After review, finish any deferred
 * cancellation if no approved work or other pending positive report remains.
 * The assignment and every review record are retained for the audit trail. */
export async function releaseUnperformedAssignmentAfterReview(tx: Prisma.TransactionClient, assignmentId: string) {
  const assignment = await tx.assignment.findFirst({ where: {
    id: assignmentId, status: { in: ['PENDING', 'ACCEPTED'] }, ...unperformedAssignmentWhere(),
  }, select: { id: true, requestId: true, teacherId: true, date: true, teacher: { select: { userId: true } } } });
  if (!assignment) return false;

  const events = await tx.requestLifecycleEvent.findMany({ where: {
    requestId: assignment.requestId,
  }, select: { action: true, lastDay: true, createdAt: true } });
  let cancelled = events.some(event => lifecycleEventCancelsAssignment(assignment.date, event));
  if (!cancelled) {
    const start = toCanonicalUtcDate(assignment.date);
    const end = new Date(start.getTime() + 86399999);
    const absence = await tx.absence.findFirst({ where: {
      teacherId: assignment.teacherId, date: { gte: start, lte: end },
    }, select: { id: true } });
    const leave = absence ? null : await tx.leavePeriod.findFirst({ where: {
      ...(assignment.teacher.userId ? { teacher: { userId: assignment.teacher.userId } } : { teacherId: assignment.teacherId }),
      startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }],
    }, select: { id: true } });
    cancelled = Boolean(absence || leave);
  }
  if (!cancelled) return false;
  const updated = await tx.assignment.updateMany({ where: {
    id: assignmentId, status: { in: ['PENDING', 'ACCEPTED'] }, ...unperformedAssignmentWhere(),
  }, data: { status: 'REJECTED' } });
  if (!updated.count) return false;
  await recalculateRequestStatus(tx, assignment.requestId);
  return true;
}
