import { getSchoolYearForDate } from '@/lib/schoolYear';

/** Maps a validated YYYY-MM month to the German school year it belongs to. */
export function schoolYearForExportMonth(year: number, month: number): string {
  return getSchoolYearForDate(new Date(Date.UTC(year, month - 1, 1)));
}
