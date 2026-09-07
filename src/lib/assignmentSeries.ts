import { toLocalDateInputValue, parseDateKeyStrict } from './dateKey';

export interface ProofAssignment {
  id: string;
  date: Date | string;
  hours: number;
  status: string;
}

export function assignmentDay(value: Date | string): string {
  return toLocalDateInputValue(value instanceof Date ? value : new Date(value));
}

function nextTeachingDay(key: string): string {
  const next = parseDateKeyStrict(key);
  do { next.setUTCDate(next.getUTCDate() + 1); } while ([0, 6].includes(next.getUTCDay()));
  return next.toISOString().slice(0, 10);
}

/** Callers supply only assignments of the same teacher and request. Never bridge
 * a missing teaching day or a cancelled assignment, and never infer future days. */
export function getAssignmentSeries<T extends ProofAssignment>(anchor: T, assignments: T[]): T[] {
  if (anchor.status === 'REJECTED') return [anchor];
  const active = assignments.filter(a => a.status !== 'REJECTED')
    .sort((a, b) => assignmentDay(a.date).localeCompare(assignmentDay(b.date)));
  const index = active.findIndex(a => a.id === anchor.id);
  if (index < 0) return [anchor];
  let start = index;
  let end = index;
  while (start > 0 && nextTeachingDay(assignmentDay(active[start - 1].date)) === assignmentDay(active[start].date)) start--;
  while (end + 1 < active.length && nextTeachingDay(assignmentDay(active[end].date)) === assignmentDay(active[end + 1].date)) end++;
  return active.slice(start, end + 1);
}

export function formatProofDate(value: Date | string): string {
  return new Date(value).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
}
