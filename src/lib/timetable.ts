export type Timetable = Record<string, number[]>;

/** An empty timetable is valid availability: it offers no lessons. */
export function isTimetable(value: unknown): value is Timetable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([weekday, hours]) =>
    /^[1-5]$/.test(weekday) &&
    Array.isArray(hours) &&
    hours.length <= 10 &&
    hours.every(hour => Number.isInteger(hour) && hour >= 1 && hour <= 10) &&
    new Set(hours).size === hours.length,
  );
}

/** Invalid legacy data must never break matching for all other reserves. */
export function parseStoredTimetable(raw?: string | null): Timetable | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isTimetable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
