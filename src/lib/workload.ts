import { toLocalDateInputValue } from '@/lib/dateKey';
import { mondayOf, shiftDateKey } from '@/lib/classContinuity';

export type WorkloadTotals = { hours: number; accepted: number; pending: number; days: number };
export type WorkloadPeriod = WorkloadTotals & { key: string; start: string; end: string };
export type TeacherWorkload = {
  id: string; name: string; school: string; maxWeeklyHours: number;
  total: WorkloadTotals; months: WorkloadPeriod[]; weeks: WorkloadPeriod[];
};
export type WorkloadReport = { schoolYear: string; generatedAt: string; retentionNotice: string | null; teachers: TeacherWorkload[] };
export type WorkloadTeacherInput = {
  id: string; name: string; maxWeeklyHours: number; stammschule: { name: string };
  assignments: { date: Date | string; hours: number; status: string; request?: { status: string } }[];
};

export const emptyWorkload = (): WorkloadTotals => ({ hours: 0, accepted: 0, pending: 0, days: 0 });

/** Sum assigned teaching units, never infer worked hours from confirmation or elapsed dates. */
export function buildWorkloadReport(schoolYear: string, teachers: WorkloadTeacherInput[], now = new Date()): WorkloadReport {
  const [startYear, endYear] = schoolYear.split('/');
  const start = `${startYear}-09-01`, end = `${endYear}-08-31`;
  const cutoff = shiftDateKey(toLocalDateInputValue(now), -400);
  const retentionNotice = start < cutoff
    ? 'Dieses Schuljahr kann unvollständig sein: Einsätze abgeschlossener Bedarfe werden nach 400 Tagen gelöscht. Gelöschte Einsätze fehlen in den Summen; vorhandene Schuljahresarchive bleiben die historische Grundlage.'
    : null;
  return { schoolYear, generatedAt: now.toISOString(), retentionNotice, teachers: teachers.map(teacher => {
    const total = emptyWorkload();
    const days = new Set<string>();
    const months = new Map<string, WorkloadPeriod>();
    const weeks = new Map<string, WorkloadPeriod>();
    for (const assignment of teacher.assignments) {
      if (!['PENDING', 'ACCEPTED'].includes(assignment.status) || assignment.request?.status === 'CANCELLED') continue;
      if (!Number.isFinite(assignment.hours) || assignment.hours <= 0) continue;
      const assignmentDate = new Date(assignment.date);
      if (Number.isNaN(assignmentDate.getTime())) continue;
      const day = toLocalDateInputValue(assignmentDate);
      if (day < start || day > end) continue;
      const month = day.slice(0, 7);
      const week = mondayOf(day);
      const [y, m] = month.split('-').map(Number);
      const monthly = months.get(month) ?? { ...emptyWorkload(), key: month, start: `${month}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
      const weekly = weeks.get(week) ?? { ...emptyWorkload(), key: week, start: week < start ? start : week, end: shiftDateKey(week, 6) > end ? end : shiftDateKey(week, 6) };
      for (const bucket of [total, monthly, weekly]) {
        bucket.hours += assignment.hours;
        bucket[assignment.status === 'ACCEPTED' ? 'accepted' : 'pending'] += assignment.hours;
        if (!days.has(day)) bucket.days += 1;
      }
      days.add(day);
      months.set(month, monthly);
      weeks.set(week, weekly);
    }
    return { id: teacher.id, name: teacher.name, school: teacher.stammschule.name, maxWeeklyHours: teacher.maxWeeklyHours, total,
      months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
      weeks: [...weeks.values()].sort((a, b) => a.key.localeCompare(b.key)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de')) };
}

export function workloadFor(teacher: TeacherWorkload, period: 'total' | 'month' | 'week', date: string): WorkloadTotals {
  if (period === 'total') return teacher.total;
  return (period === 'month' ? teacher.months.find(row => row.key === date.slice(0, 7)) : teacher.weeks.find(row => row.key === mondayOf(date))) ?? emptyWorkload();
}

function csvCell(value: string | number): string {
  const text = String(value);
  const inert = typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${inert.replace(/"/g, '""')}"`;
}

/** The export uses the same aggregates as the screen, including zero-use teachers. */
export function workloadCsv(report: WorkloadReport, options?: { date: string; teacherId?: string }): string {
  const rows: (string | number)[][] = [
    ['Schuljahr', 'Reserve-ID', 'Mobile Reserve', 'Stammschule', 'Zeitraum', 'Von', 'Bis', 'Geplant (UStd.)', 'Bestätigt (UStd.)', 'Bestätigung offen (UStd.)', 'Einsatztage', 'Wochenstundenlimit (UStd.)', 'Datengrundlage', 'Datenstand (UTC)', 'Vollständigkeit'],
  ];
  const [start, end] = report.schoolYear.split('/');
  for (const teacher of report.teachers.filter(t => !options?.teacherId || t.id === options.teacherId)) {
    const add = (label: string, from: string, until: string, totals: WorkloadTotals) => rows.push([
      report.schoolYear, teacher.id, teacher.name, teacher.school, label, from, until,
      totals.hours, totals.accepted, totals.pending, totals.days, teacher.maxWeeklyHours,
      'Zugewiesene Unterrichtsstunden; keine Erfassung tatsächlich geleisteter Arbeitszeit',
      report.generatedAt, report.retentionNotice ?? 'Auswertung der gespeicherten Einsätze. Gelöschte Zuweisungen sind nicht enthalten.',
    ]);
    add('Gesamt im Schuljahr', `${start}-09-01`, `${end}-08-31`, teacher.total);
    if (options) {
      const monthKey = options.date.slice(0, 7);
      const [year, month] = monthKey.split('-').map(Number);
      const weekStart = mondayOf(options.date);
      add('Monat', `${monthKey}-01`, new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), workloadFor(teacher, 'month', options.date));
      add('Woche', weekStart < `${start}-09-01` ? `${start}-09-01` : weekStart,
        shiftDateKey(weekStart, 6) > `${end}-08-31` ? `${end}-08-31` : shiftDateKey(weekStart, 6), workloadFor(teacher, 'week', options.date));
    } else {
      for (const month of teacher.months) add('Monat', month.start, month.end, month);
      for (const week of teacher.weeks) add('Woche', week.start, week.end, week);
    }
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
}
