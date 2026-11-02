import { normalizeClassName } from '@/lib/classContinuity';
import { getSchoolYearDates, getSchoolYearForDate } from '@/lib/schoolYear';
import { parseDateKeyStrict, toLocalDateInputValue } from '@/lib/dateKey';

export type AssignmentHistoryEntry = {
  id: string;
  date: string;
  teacherId: string;
  teacherName: string;
  hours: number;
  status: string;
  sameRequest: boolean;
};

type HistoryRequest = { id: string; schoolId: string; locationId?: string | null; className?: string | null; status?: string };
export type HistoryAssignment = {
  id: string; date: Date | string; teacherId: string; hours: number; status: string;
  teacher: { name: string }; request: HistoryRequest;
};

export function normalizedHistoryClass(value?: string | null): string {
  return normalizeClassName(value);
}

/** The database window and the displayed history share the same school-year boundary. */
export function historyDateRange(before: string): { gte: Date; lt: Date } {
  const boundary = parseDateKeyStrict(before);
  return { gte: getSchoolYearDates(getSchoolYearForDate(boundary)).start, lt: boundary };
}

/** Index once per batch; each requirement inspects only its own/class assignments. */
export function createAssignmentHistoryLookup(assignments: HistoryAssignment[]) {
  const byRequest = new Map<string, HistoryAssignment[]>();
  const byClass = new Map<string, HistoryAssignment[]>();
  const classKey = (request: HistoryRequest) => JSON.stringify([request.schoolId, request.locationId ?? null, normalizedHistoryClass(request.className)]);
  for (const assignment of assignments) {
    const own = byRequest.get(assignment.request.id);
    if (own) own.push(assignment);
    else byRequest.set(assignment.request.id, [assignment]);
    if (!normalizedHistoryClass(assignment.request.className)) continue;
    const key = classKey(assignment.request);
    const shared = byClass.get(key);
    if (shared) shared.push(assignment);
    else byClass.set(key, [assignment]);
  }
  return (request: HistoryRequest): HistoryAssignment[] => {
    const own = byRequest.get(request.id) ?? [];
    if (!normalizedHistoryClass(request.className)) return own;
    const shared = byClass.get(classKey(request)) ?? [];
    return [...new Map([...own, ...shared].map(assignment => [assignment.id, assignment])).values()];
  };
}

/** Recorded days before the new deployment, including the current week. */
export function requestAssignmentHistory(request: HistoryRequest, assignments: HistoryAssignment[], before: string): AssignmentHistoryEntry[] {
  const year = getSchoolYearForDate(new Date(`${before}T12:00:00Z`));
  const className = normalizedHistoryClass(request.className);
  return assignments.filter(assignment => {
    if (!['PENDING', 'ACCEPTED'].includes(assignment.status) || assignment.hours <= 0) return false;
    if (assignment.request.schoolId !== request.schoolId || (assignment.request.locationId ?? null) !== (request.locationId ?? null)) return false;
    const related = assignment.request.id === request.id
      || (assignment.request.status !== 'CANCELLED' && Boolean(className) && normalizedHistoryClass(assignment.request.className) === className);
    if (!related) return false;
    const date = new Date(assignment.date);
    return !Number.isNaN(date.getTime()) && toLocalDateInputValue(date) < before && getSchoolYearForDate(date) === year;
  }).map(assignment => ({
    id: assignment.id, date: toLocalDateInputValue(new Date(assignment.date)), teacherId: assignment.teacherId,
    teacherName: assignment.teacher.name, hours: assignment.hours, status: assignment.status,
    sameRequest: assignment.request.id === request.id,
  })).sort((a, b) => b.date.localeCompare(a.date) || a.teacherName.localeCompare(b.teacherName) || a.id.localeCompare(b.id));
}

export function shortHistoryDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit' });
}

export function compactAssignmentHistory(entries: AssignmentHistoryEntry[]): string {
  const recent = entries.slice(0, 3).reverse();
  return recent.map(entry => `${shortHistoryDay(entry.date)} ${entry.teacherName}${entry.sameRequest ? '' : ' (gleiche Klasse)'}`).join(' · ');
}

export type PreviousTeacher = { teacherId: string; teacherName: string; days: number; lastDate: string; onlyOtherRequests: boolean };

/** One line per person who was already deployed here, most recent first. */
export function previousTeachersFromHistory(entries: AssignmentHistoryEntry[]): PreviousTeacher[] {
  const byTeacher = new Map<string, PreviousTeacher & { dates: Set<string> }>();
  for (const entry of entries) {
    const person = byTeacher.get(entry.teacherId) ?? { teacherId: entry.teacherId, teacherName: entry.teacherName, days: 0, lastDate: entry.date, onlyOtherRequests: true, dates: new Set<string>() };
    person.dates.add(entry.date);
    person.days = person.dates.size;
    if (entry.date > person.lastDate) person.lastDate = entry.date;
    if (entry.sameRequest) person.onlyOtherRequests = false;
    byTeacher.set(entry.teacherId, person);
  }
  return [...byTeacher.values()]
    .map(person => ({ teacherId: person.teacherId, teacherName: person.teacherName, days: person.days, lastDate: person.lastDate, onlyOtherRequests: person.onlyOtherRequests }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.teacherName.localeCompare(b.teacherName));
}
