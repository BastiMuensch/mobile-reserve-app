import { parseDateKeyStrict, toLocalDateInputValue } from './dateKey';

type RequestTiming = { startHour?: number | null; schedule?: string | null };

const isLessonHour = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;

/**
 * Der Beginn des Bedarfs am konkreten Einsatztag. Bei Wochenstundenplänen ist
 * startHour nur ein alter Platzhalter und darf den Tagesplan nicht überstimmen.
 * Ein manuell hinzugefügter Tag ohne Plan erhält keinen erfundenen Beginn.
 */
export function requestStartHourForDay(
  request: RequestTiming | null | undefined,
  date: Date | string,
): number | null {
  if (!request) return null;
  if (!request.schedule) return isLessonHour(request.startHour) ? request.startHour : null;
  try {
    const schedule: unknown = JSON.parse(request.schedule);
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return null;
    const parsedDate = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsedDate.getTime())) return null;
    const day = parseDateKeyStrict(toLocalDateInputValue(parsedDate)).getUTCDay() || 7;
    const hours: unknown = (schedule as Record<string, unknown>)[String(day)];
    if (!Array.isArray(hours) || hours.length === 0 || !hours.every(isLessonHour)) return null;
    return Math.min(...hours);
  } catch {
    return null;
  }
}

export function requestStartLabelForDay(request: RequestTiming | null | undefined, date: Date | string): string {
  const start = requestStartHourForDay(request, date);
  return start === null ? 'Beginn bitte mit der Schule abstimmen' : `ab ${start}. Std.`;
}
