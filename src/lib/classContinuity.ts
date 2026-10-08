import { parseDateKeyStrict, toLocalDateInputValue } from '@/lib/dateKey';
import { getSchoolYearForDate } from '@/lib/schoolYear';

type ClassRequest = {
  id: string;
  schoolId: string;
  locationId?: string | null;
  className?: string | null;
  date: Date | string;
  endDate?: Date | string | null;
  isOpenEnded?: boolean | null;
};

export type ContinuityAssignment = {
  date: Date | string;
  hours: number;
  status: string;
  requestId?: string;
  request?: { schoolId: string; locationId?: string | null; className?: string | null; status?: string };
};

export type ClassContinuity = {
  basis: 'class' | 'request';
  days: number;
  hours: number;
  weekStart: string;
  weekEnd: string;
  bonus: number;
};

/** Calendar-week boundaries in date-key space, independent of host timezone/DST. */
export function mondayOf(dateKey: string): string {
  const date = parseDateKeyStrict(dateKey);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function shiftDateKey(dateKey: string, days: number): string {
  const date = parseDateKeyStrict(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizedClass(value?: string | null): string {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
}

/** Only recorded assignments count; no inference from a substitute teacher's name. */
export function getClassContinuity(
  request: ClassRequest,
  assignments: ContinuityAssignment[],
  firstOpenDay: string,
): ClassContinuity {
  const weekStart = shiftDateKey(mondayOf(firstOpenDay), -7);
  const weekEnd = shiftDateKey(weekStart, 6);
  const className = normalizedClass(request.className);
  const dates = new Set<string>();
  let hours = 0;
  for (const assignment of assignments) {
    if (!['PENDING', 'ACCEPTED'].includes(assignment.status) || assignment.hours <= 0) continue;
    if (assignment.request?.status === 'CANCELLED') continue;
    const assignmentDate = new Date(assignment.date);
    if (Number.isNaN(assignmentDate.getTime())) continue;
    const key = toLocalDateInputValue(assignmentDate);
    if (key < weekStart || key > weekEnd) continue;
    // A label such as "3a" can refer to different children in the next school year.
    if (getSchoolYearForDate(new Date(assignment.date)) !== getSchoolYearForDate(parseDateKeyStrict(firstOpenDay))) continue;
    const sameClass = assignment.request?.schoolId === request.schoolId
      && (assignment.request.locationId ?? null) === (request.locationId ?? null)
      && normalizedClass(assignment.request.className) === className;
    if (className ? !sameClass : assignment.requestId !== request.id) continue;
    dates.add(key);
    hours += assignment.hours;
  }
  const longTerm = request.isOpenEnded || (request.endDate && new Date(request.endDate) > new Date(request.date));
  return {
    basis: className ? 'class' : 'request', days: dates.size, hours, weekStart, weekEnd,
    // More than distance/preference; less than qualification and home-school priority.
    bonus: longTerm && dates.size > 0 ? 120 + Math.min(dates.size, 7) * 15 : 0,
  };
}

export function classContinuityLabel(continuity: ClassContinuity): string {
  return `Vorwoche: ${continuity.days} ${continuity.days === 1 ? 'Tag' : 'Tage'} · ${continuity.hours} UStd. ${continuity.basis === 'class' ? 'in derselben Klasse' : 'in dieser Anforderung'} eingeplant`;
}
