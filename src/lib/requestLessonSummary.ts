import { toLocalDateInputValue } from './dateKey';
import { scheduledLessonHoursForDay } from './requestTiming';
import { parseTimetableSchedule } from './requestValidation';

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];

type RequestLessonPlan = {
  schedule?: string | null;
  date?: Date | string;
  endDate?: Date | string | null;
  isOpenEnded?: boolean | null;
};

export function hasWeeklyRequestSchedule(request: RequestLessonPlan): boolean {
  if (!request.schedule) return false;
  if (request.isOpenEnded) return true;
  if (!request.endDate) return false;
  return !request.date || toLocalDateInputValue(new Date(request.date)) !== toLocalDateInputValue(new Date(request.endDate));
}

const formatLessonHours = (hours: number[]) => `${hours.map(hour => `${hour}.`).join(', ')} Std.`;

/** Lesson numbers, without inferring clock times or a uniform start for weekly plans. */
export function requestLessonSummary(request: RequestLessonPlan & { startHour: number }): string {
  if (!request.schedule) return `ab ${request.startHour}. Std.`;
  const weekly = hasWeeklyRequestSchedule(request);
  if (!weekly && request.date) {
    const hours = scheduledLessonHoursForDay(request.schedule, request.date);
    return hours?.length ? formatLessonHours(hours) : 'Unterricht laut Tagesplan';
  }
  try {
    const schedule = parseTimetableSchedule(request.schedule);
    if (schedule) {
      return WEEKDAY_LABELS.flatMap((label, index) => {
        const hours = [...(schedule[String(index + 1)] ?? [])].sort((a, b) => a - b);
        return hours.length ? [`${weekly ? `${label}: ` : ''}${formatLessonHours(hours)}`] : [];
      }).join(' · ');
    }
  } catch {
    // A legacy malformed schedule must not turn its placeholder into a start time.
  }
  return weekly ? 'Unterricht laut Wochenstundenplan' : 'Unterricht laut Tagesplan';
}
