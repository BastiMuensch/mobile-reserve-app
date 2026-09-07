import { z } from 'zod';

export const schoolYearSchema = z.string().regex(/^(\d{4})\/(\d{4})$/, "Ungültiges Schuljahr.").refine(value => {
  const [start, end] = value.split("/").map(Number);
  return end === start + 1;
}, "Ungültiges Schuljahr.");

export function getCurrentSchoolYear(): string {
  return getSchoolYearForDate(new Date());
}

const germanCalendarParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: 'numeric',
});

/** Returns the German school year containing a calendar date (1 Sep to 31 Aug). */
export function getSchoolYearForDate(date: Date): string {
  const parts = germanCalendarParts.formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Ungültiges Datum für die Schuljahresberechnung.');
  }
  
  if (month >= 9) {
    return `${year}/${year + 1}`;
  } else {
    return `${year - 1}/${year}`;
  }
}

export function getLastSchoolYear(): string {
  const current = getCurrentSchoolYear();
  const startYear = parseInt(current.split('/')[0]);
  return `${startYear - 1}/${startYear}`;
}

export function getNextSchoolYear(): string {
  const current = getCurrentSchoolYear();
  const startYear = parseInt(current.split('/')[0]);
  return `${startYear + 1}/${startYear + 2}`;
}

export function getSchoolYearDates(schoolYearStr: string): { start: Date, end: Date } {
  // Format: "2025/2026"
  const parts = schoolYearStr.split('/');
  const startYear = parseInt(parts[0]);
  const endYear = parseInt(parts[1]);
  
  return {
    start: new Date(`${startYear}-09-01T00:00:00.000Z`),
    end: new Date(`${endYear}-08-31T23:59:59.999Z`)
  };
}
