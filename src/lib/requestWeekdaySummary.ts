import { parseDateKeyStrict, toLocalDateInputValue } from './dateKey';
import { parseTimetableSchedule } from './requestValidation';
import { getOpenRequestDays } from './requestDays';
import { activeUnfilledDays } from './unfilledDays';
import type { RequestData } from '@/types/models';

const WEEKDAYS = [
  { day: 1, label: 'Mo', name: 'Montag' },
  { day: 2, label: 'Di', name: 'Dienstag' },
  { day: 3, label: 'Mi', name: 'Mittwoch' },
  { day: 4, label: 'Do', name: 'Donnerstag' },
  { day: 5, label: 'Fr', name: 'Freitag' },
] as const;

type RequestWeekdayInput = Pick<RequestData, 'date' | 'endDate' | 'isOpenEnded' | 'schedule' | 'hours' | 'endedAt' | 'unfilledDays'>
  & Partial<Pick<RequestData, 'assignments' | 'status'>>;

function localCalendarDate(value: string): Date {
  const key = value.slice(0, 10);
  parseDateKeyStrict(key);
  return new Date(`${key}T12:00:00`);
}

/**
 * Eine konkrete Planungswoche mit angefragten und noch offenen Stunden je Datum.
 * Die Woche enthält bevorzugt den nächsten offenen Tag ab heute. Tagesabsagen,
 * abgesagte Reststunden und stornierte Zuweisungen folgen derselben Berechnung
 * wie die Besetzung. Mehrere Montage werden deshalb niemals zusammengezählt.
 */
export function getRequestWeekdaySummary(request: RequestWeekdayInput, today = new Date()) {
  try {
    const schedule = parseTimetableSchedule(request.schedule);
    const start = localCalendarDate(request.date);
    const end = request.endDate ? localCalendarDate(request.endDate) : undefined;
    if ((end && end < start) || (!schedule && (!Number.isFinite(request.hours) || request.hours <= 0))) return null;

    const normalized = {
      ...request,
      date: start,
      endDate: end,
      endedAt: request.endedAt ? localCalendarDate(request.endedAt) : undefined,
    };
    const assignments = (request.assignments ?? []).map(assignment => ({
      ...assignment, date: localCalendarDate(assignment.date),
    }));
    const todayKey = toLocalDateInputValue(today);
    const planningToday = localCalendarDate(todayKey);
    const requiredDays = getOpenRequestDays({ ...normalized, unfilledDays: null }, [], planningToday);
    const wholeRequestClosed = request.status === 'CANCELLED' || (request.status === 'UNFILLED' && !request.unfilledDays);
    const openDays = wholeRequestClosed ? [] : getOpenRequestDays(normalized, assignments, planningToday);
    const firstDate = openDays.find(day => day.date >= todayKey)?.date
      ?? openDays[0]?.date
      ?? requiredDays.find(day => day.date >= todayKey)?.date
      ?? requiredDays[0]?.date;
    if (!firstDate) return null;

    const monday = parseDateKeyStrict(firstDate);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const requiredByDate = new Map(requiredDays.map(day => [day.date, day.hours]));
    const openByDate = new Map(openDays.map(day => [day.date, day.hours]));
    const declinedDates = new Set(activeUnfilledDays(request.unfilledDays).map(day => day.date));

    const days = WEEKDAYS.map(weekday => {
      const date = new Date(monday);
      date.setUTCDate(monday.getUTCDate() + weekday.day - 1);
      const dateKey = date.toISOString().slice(0, 10);
      const requiredHours = requiredByDate.get(dateKey) ?? 0;
      const activeAssignments = (request.assignments ?? []).filter(assignment =>
        assignment.status !== 'REJECTED' && assignment.status !== 'CANCELLED'
        && assignment.date.slice(0, 10) === dateKey);
      const assignedHours = activeAssignments.reduce((sum, assignment) => sum + assignment.hours, 0);
      const cancelledHours = activeAssignments.reduce((sum, assignment) => sum + (assignment.cancelledHours ?? 0), 0);
      const declinedHours = Math.min(requiredHours, wholeRequestClosed || declinedDates.has(dateKey)
        ? Math.max(0, requiredHours - assignedHours)
        : cancelledHours);
      return {
        ...weekday,
        date: dateKey,
        requiredHours,
        openHours: Math.max(0, openByDate.get(dateKey) ?? 0),
        declinedHours,
      };
    });
    return days.some(day => day.requiredHours > 0)
      ? { weekStart: days[0].date, weekEnd: days[4].date, days }
      : null;
  } catch {
    // Ein fehlerhafter Stundenplan darf keine erfundene Tagesverteilung ergeben.
    return null;
  }
}
