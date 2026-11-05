import { assignmentLessonHours } from './assignmentTiming';
import { toLocalDateInputValue } from './dateKey';

export type BookingAssignment = {
  date: Date | string;
  hours: number;
  lessonHours?: string | null;
  status?: string;
  requestId?: string;
  request?: { schoolId: string; locationId?: string | null; status?: string };
};

export type ProposedBooking = {
  date: Date | string;
  hours: number;
  lessonHours?: string | null;
  requestId: string;
  schoolId: string;
  locationId?: string | null;
};

/** A short assignment reserves the whole day at its site. Only another known,
 * disjoint lesson block of a different request at that same site can share it.
 * Missing legacy evidence never silently releases the day lock. */
export function hasAssignmentBookingConflict(existing: BookingAssignment[], proposed: ProposedBooking): boolean {
  const key = toLocalDateInputValue(new Date(proposed.date));
  const proposedSlots = assignmentLessonHours(proposed);
  return existing.some(assignment => {
    if (assignment.status === 'REJECTED' || assignment.status === 'CANCELLED'
      || assignment.request?.status === 'CANCELLED' || assignment.hours <= 0
      || toLocalDateInputValue(new Date(assignment.date)) !== key) return false;
    if (!assignment.requestId || assignment.requestId === proposed.requestId
      || !assignment.request || assignment.request.schoolId !== proposed.schoolId
      || (assignment.request.locationId ?? null) !== (proposed.locationId ?? null)) return true;
    const existingSlots = assignmentLessonHours(assignment);
    return !proposedSlots || !existingSlots || existingSlots.some(hour => proposedSlots.includes(hour));
  });
}
