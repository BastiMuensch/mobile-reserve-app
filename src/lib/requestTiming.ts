import { parseDateKeyStrict, toLocalDateInputValue } from './dateKey';

type RequestTiming = { startHour?: number | null; hours?: number; schedule?: string | null };

const isLessonHour = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;

export function scheduledLessonHoursForDay(schedule: string, date: Date | string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(schedule);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const parsedDate = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsedDate.getTime())) return null;
    const day = parseDateKeyStrict(toLocalDateInputValue(parsedDate)).getUTCDay() || 7;
    const hours: unknown = (parsed as Record<string, unknown>)[String(day)];
    if (!Array.isArray(hours) || !hours.every(isLessonHour) || new Set(hours).size !== hours.length) return null;
    return [...hours].sort((a, b) => a - b);
  } catch {
    return null;
  }
}

/** Concrete lesson slots, never clock times or a weekly plan's placeholder start. */
export function requestLessonHoursForDay(request: RequestTiming, date: Date | string): number[] | null {
  if (request.schedule) return scheduledLessonHoursForDay(request.schedule, date);
  if (!isLessonHour(request.startHour) || !request.hours || !Number.isInteger(request.hours) || request.hours < 1 || request.hours > 10) return null;
  const hours = Array.from({ length: request.hours }, (_, index) => request.startHour! + index);
  return hours.every(isLessonHour) ? hours : null;
}

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
  const hours = scheduledLessonHoursForDay(request.schedule, date);
  return hours?.length ? hours[0] : null;
}

export function requestStartLabelForDay(request: RequestTiming | null | undefined, date: Date | string): string {
  const start = requestStartHourForDay(request, date);
  return start === null ? 'Beginn bitte mit der Schule abstimmen' : `ab ${start}. Std.`;
}
