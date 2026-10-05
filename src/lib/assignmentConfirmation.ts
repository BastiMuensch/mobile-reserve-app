import { toLocalDateInputValue } from './dateKey';

interface ConfirmableAssignment {
  id: string;
  requestId: string;
  teacherId: string;
  date: Date | string;
  status: string;
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
