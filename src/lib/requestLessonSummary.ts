import { parseTimetableSchedule } from './requestValidation';

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];

/** Lesson numbers, without inferring clock times or a uniform start for weekly plans. */
export function requestLessonSummary(request: { schedule?: string | null; startHour: number }): string {
  if (!request.schedule) return `ab ${request.startHour}. Std.`;
  try {
    const schedule = parseTimetableSchedule(request.schedule);
    if (schedule) {
      return WEEKDAY_LABELS.flatMap((label, index) => {
        const hours = [...(schedule[String(index + 1)] ?? [])].sort((a, b) => a - b);
        return hours.length ? [`${label}: ${hours.map(hour => `${hour}.`).join(', ')} Std.`] : [];
      }).join(' · ');
    }
  } catch {
    // A legacy malformed schedule must not turn its placeholder into a start time.
  }
  return 'Unterricht laut Wochenstundenplan';
}
