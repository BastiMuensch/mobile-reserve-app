import { toLocalDateInputValue } from './dateKey';
import { assignmentLessonHours, assignmentStartHour } from './assignmentTiming';

interface ConfirmableAssignment {
  id: string;
  requestId: string;
  teacherId: string;
  date: Date | string;
  status: string;
}

interface DayAssignment extends ConfirmableAssignment {
  hours: number;
  lessonHours?: string | null;
  request?: { schoolId: string; locationId?: string | null; status?: string };
}

/** A day's view retains every request as a separate block at the same site. */
export function getAssignmentDayPlan<T extends DayAssignment>(anchor: T, assignments: T[]): T[] {
  if (!anchor.request) return [anchor];
  return assignments.filter(item =>
    item.teacherId === anchor.teacherId &&
    toLocalDateInputValue(new Date(item.date)) === toLocalDateInputValue(new Date(anchor.date)) &&
    item.request?.schoolId === anchor.request!.schoolId &&
    (item.request?.locationId ?? null) === (anchor.request!.locationId ?? null) &&
    ['PENDING', 'ACCEPTED'].includes(item.status) && item.request?.status !== 'CANCELLED',
  ).sort((a, b) => (assignmentStartHour(a) ?? 11) - (assignmentStartHour(b) ?? 11) || a.id.localeCompare(b.id));
}

/** Explicit same-day confirmations cannot acknowledge another site or unknown/overlapping blocks. */
export function isValidDayConfirmation(anchor: DayAssignment, assignments: DayAssignment[]): boolean {
  if (!assignments.length || !assignments.some(item => item.id === anchor.id)) return false;
  if (getAssignmentDayPlan(anchor, assignments).length !== assignments.length) return false;
  if (assignments.length === 1) return true;
  const requests = new Set<string>();
  const occupied = new Set<number>();
  for (const item of assignments) {
    const lessons = assignmentLessonHours(item);
    if (!lessons || requests.has(item.requestId) || lessons.some(hour => occupied.has(hour))) return false;
    requests.add(item.requestId);
    lessons.forEach(hour => occupied.add(hour));
  }
  return true;
}

/** Confirmation covers actual pending days of one request/teacher, including
 * part-time schedules and gaps. This intentionally differs from proof grouping. */
export function getPendingAssignmentConfirmations<T extends ConfirmableAssignment>(
  anchor: T,
  assignments: T[],
  today = toLocalDateInputValue(),
): T[] {
  return assignments.filter(assignment =>
    assignment.teacherId === anchor.teacherId &&
    assignment.requestId === anchor.requestId &&
    assignment.status === 'PENDING' &&
    toLocalDateInputValue(new Date(assignment.date)) >= today,
  ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id.localeCompare(b.id));
}

export function formatConfirmationDate(value: Date | string): string {
  return new Date(value).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
}
