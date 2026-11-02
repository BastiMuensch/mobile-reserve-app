import { parseDateKeyStrict } from '@/lib/dateKey';

export function shiftPlanningDay(day: string, offset: number): string {
  const date = parseDateKeyStrict(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function planningQuickUntil(today: string, preset: 'today' | 'week' | 'nextWeek'): string {
  if (preset === 'today') return today;
  const weekday = parseDateKeyStrict(today).getUTCDay();
  const remaining = (7 - weekday) % 7;
  return shiftPlanningDay(today, remaining + (preset === 'nextWeek' ? 7 : 0));
}

export function formatPlanningDate(day: string, weekday = false): string {
  return parseDateKeyStrict(day).toLocaleDateString('de-DE', { timeZone: 'UTC', ...(weekday ? { weekday: 'long' as const } : {}), day: '2-digit', month: '2-digit', year: 'numeric' });
}
