import type { TeacherData } from '@/types/models';
import { parseDateKeyStrict, toLocalDateInputValue } from './dateKey';
import { parseTimetableSchedule } from './requestValidation';
import { getSchoolYearForDate } from './schoolYear';

const nameCollator = new Intl.Collator('de', { sensitivity: 'base' });

function nameParts(name: string): [string, string] {
  const normalized = name.trim().replace(/\s+/g, ' ');
  const comma = normalized.indexOf(',');
  if (comma >= 0) return [normalized.slice(0, comma).trim(), normalized.slice(comma + 1).trim()];
  // Names are stored in a single field as "Vorname Nachname".
  // Keep hyphenated surnames intact and use given names to break ties.
  const parts = normalized.split(' ');
  return [parts.pop() ?? '', parts.join(' ')];
}

export function compareTeachersByLastName(a: Pick<TeacherData, 'name'>, b: Pick<TeacherData, 'name'>): number {
  const [aLast, aFirst] = nameParts(a.name);
  const [bLast, bFirst] = nameParts(b.name);
  return nameCollator.compare(aLast, bLast) || nameCollator.compare(aFirst, bFirst);
}

/** Any active assignment occupies the whole day, regardless of remaining hours. */
export function getAvailableTeachersToday(teachers: TeacherData[], now: Date = new Date()): TeacherData[] {
  const today = toLocalDateInputValue(now);
  const weekday = parseDateKeyStrict(today).getUTCDay();
  if (weekday === 0 || weekday === 6) return [];
  const schoolYear = getSchoolYearForDate(now);

  return teachers.filter(teacher => {
    if (teacher.schoolYear !== schoolYear || teacher.status !== 'ACTIVE' || teacher.currentLeave || teacher.isAbsentToday) return false;
    if (teacher.assignments?.some(assignment => assignment.status !== 'REJECTED' && toLocalDateInputValue(new Date(assignment.date)) === today)) return false;
    if (!teacher.isPartTime) return true;
    try {
      const schedule = parseTimetableSchedule(teacher.schedule);
      return (schedule?.[String(weekday)]?.length ?? 0) > 0;
    } catch {
      // Missing or invalid part-time schedules do not establish availability.
      return false;
    }
  });
}
