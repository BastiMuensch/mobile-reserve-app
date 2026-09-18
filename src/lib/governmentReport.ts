import { z } from 'zod';
import { inclusiveCalendarDaysBetween, isValidDateKey, parseDateKeyStrict, toLocalDateInputValue } from './dateKey';
import { getSchoolYearForDate } from './schoolYear';

export const reportingCategories = { UNKNOWN: 'Bitte zuordnen', GS_MS: 'GS / MS', EG: 'Fachlehrkraft EG', MT: 'Fachlehrkraft MT', OTHER: 'Sonstige Fachlehrkraft' } as const;
export const reportingStates = { LONG: 'Langfristig im Einsatz', SHORT: 'Kurzfristig im Einsatz', READY: 'Nicht im Einsatz, einsatzfähig', UNAVAILABLE: 'Nicht im Einsatz, nicht einsatzfähig' } as const;
export type ReportingState = keyof typeof reportingStates;
const dateSchema = z.string().refine(isValidDateKey, 'Bitte ein gültiges Datum angeben.');
export const reportingSettingSchema = z.object({
  category: z.enum(['UNKNOWN', 'GS_MS', 'EG', 'MT', 'OTHER']),
  included: z.boolean(),
  weeklyHours: z.number().finite().min(0).max(60).multipleOf(0.5),
  effectiveFrom: dateSchema,
}).strict();
export type ReportingSetting = z.infer<typeof reportingSettingSchema>;
export const reportingEntrySchema = z.object({
  teacherId: z.string().min(1).max(100),
  setting: reportingSettingSchema,
  state: z.enum(['LONG', 'SHORT', 'READY', 'UNAVAILABLE']),
}).strict();
export type ReportingEntry = z.infer<typeof reportingEntrySchema>;
export const governmentReportInputSchema = z.object({
  date: dateSchema,
  office: z.string().trim().min(1, 'Bitte das Schulamtskürzel eintragen.').max(100),
  internalShort: z.number().int().min(0).max(100000).nullable(),
  internalLong: z.number().int().min(0).max(100000).nullable(),
  entries: z.array(reportingEntrySchema).max(5000),
  reviewed: z.boolean(),
  expectedUpdatedAt: z.string().datetime().nullable(),
}).strict().superRefine((value, ctx) => {
  if (!isValidDateKey(value.date) || value.entries.some(e => !isValidDateKey(e.setting.effectiveFrom))) return;
  if (new Set(value.entries.map(e => e.teacherId)).size !== value.entries.length) ctx.addIssue({ code: 'custom', message: 'Lehrkräfte dürfen nicht doppelt vorkommen.' });
  const year = getSchoolYearForDate(parseDateKeyStrict(value.date));
  for (const entry of value.entries) {
    if (entry.setting.effectiveFrom > value.date || getSchoolYearForDate(parseDateKeyStrict(entry.setting.effectiveFrom)) !== year) {
      ctx.addIssue({ code: 'custom', message: 'Gültig ab muss im Schuljahr und spätestens am Stichtag liegen.' });
    }
  }
  if (value.reviewed && (value.internalShort === null || value.internalLong === null || value.entries.some(e => e.setting.category === 'UNKNOWN'))) {
    ctx.addIssue({ code: 'custom', message: 'Vor der Freigabe alle Lehrkräfte zuordnen und 6a/6b ausfüllen.' });
  }
});
export type GovernmentReportInput = z.infer<typeof governmentReportInputSchema>;

export interface ReportTeacher {
  id: string;
  name: string;
  maxWeeklyHours: number;
  status: string;
  schedule: string | null;
  reportingPeriods: { effectiveFrom: Date; category: string; included: boolean; weeklyHours: number }[];
  absences: { date: Date }[];
  leavePeriods: { startDate: Date; endDate: Date | null }[];
  assignments: { requestId: string; date: Date; hours: number; status: string; request: { status: string; date: Date; endDate: Date | null; isOpenEnded: boolean } }[];
}
export interface ReportingRow extends ReportingEntry {
  name: string;
  suggestedState: ReportingState;
  notes: string[];
  configuredFrom: string | null;
}
export type ReportTotals = ReturnType<typeof calculateReportTotals>;

export function calculateReportTotals(entries: ReportingEntry[]) {
  const counted = entries.filter(e => e.setting.category === 'GS_MS' && e.setting.included);
  const long = counted.filter(e => e.state === 'LONG').length;
  const short = counted.filter(e => e.state === 'SHORT').length;
  return {
    people: counted.length,
    hours: counted.reduce((sum, e) => sum + e.setting.weeklyHours, 0),
    long, short, deployed: long + short,
    idle: counted.length - long - short,
    ready: counted.filter(e => e.state === 'READY').length,
  };
}

/** Duration belongs to the teacher's actual assignment, not the age of the request.
 * Unknown ends never turn a generated future planning horizon into a known duration.
 * Isolated assignments separated by more than a week are separate episodes. Shorter
 * gaps may be part-time/holidays; the editable preview exposes that assumption. */
export function suggestReportingRow(teacher: ReportTeacher, date: string): ReportingRow {
  const periods = teacher.reportingPeriods.filter(p => toLocalDateInputValue(p.effectiveFrom) <= date)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  const period = periods[0];
  const category = reportingSettingSchema.shape.category.safeParse(period?.category);
  const setting: ReportingSetting = {
    category: category.success ? category.data : 'UNKNOWN',
    included: period?.included ?? true,
    weeklyHours: period?.weeklyHours ?? teacher.maxWeeklyHours,
    effectiveFrom: date,
  };
  const notes: string[] = [];
  const active = teacher.assignments.filter(a => a.status !== 'REJECTED' && a.hours > 0 && a.request.status !== 'CANCELLED'
    && toLocalDateInputValue(a.date) >= toLocalDateInputValue(a.request.date)
    && (!a.request.endDate || toLocalDateInputValue(a.date) <= toLocalDateInputValue(a.request.endDate)));
  const today = active.filter(a => toLocalDateInputValue(a.date) === date);
  const absent = teacher.absences.some(a => toLocalDateInputValue(a.date) === date);
  const leave = teacher.leavePeriods.some(p => toLocalDateInputValue(p.startDate) <= date && (!p.endDate || toLocalDateInputValue(p.endDate) >= date));
  let state: ReportingState = 'READY';
  if (absent || leave) {
    state = 'UNAVAILABLE';
    notes.push(leave ? 'Abwesenheitszeitraum: dauerhaften Ausschluss bitte prüfen.' : 'Tagesabwesenheit: bleibt im MR-Bestand.');
    if (today.length) notes.push('Trotz Abwesenheit besteht eine Zuweisung. Bitte prüfen.');
  } else if (today.length) {
    state = 'SHORT';
    let hasLong = false;
    let hasShort = false;
    for (const assignment of today) {
      const days = [...new Set(active.filter(a => a.requestId === assignment.requestId).map(a => toLocalDateInputValue(a.date)))].sort();
      let first = days.indexOf(date), last = first;
      while (first > 0 && inclusiveCalendarDaysBetween(days[first - 1], days[first]) <= 8) first--;
      while (last + 1 < days.length && inclusiveCalendarDaysBetween(days[last], days[last + 1]) <= 8) last++;
      const durationEnd = assignment.request.isOpenEnded ? date : days[last];
      if (inclusiveCalendarDaysBetween(days[first], durationEnd) > 28) hasLong = true;
      else hasShort = true;
    }
    if (hasLong) state = 'LONG';
    if (hasLong && hasShort) notes.push('Kurz- und langfristige Einsätze: Zuordnung prüfen; Person wird einmal gezählt.');
    notes.push('Dauer anhand der Zuweisungen vorgeschlagen. Unterbrechungen und bekannte Verlängerungen bitte prüfen.');
  } else {
    notes.push('Keine Zuweisung am Stichtag. Laufende Einsätze an anderen Wochentagen bitte prüfen.');
    // Undated legacy flags cannot remove someone from historic stock.
    if (teacher.status !== 'ACTIVE') notes.push('Aktueller Profilstatus ist nicht aktiv; Einsatzfähigkeit am Stichtag prüfen.');
  }
  if (!period) notes.push('Lehrkraftart und maximale mobile Wochenstunden noch nicht bestätigt.');
  return { teacherId: teacher.id, name: teacher.name, setting, state, suggestedState: state, notes, configuredFrom: period ? toLocalDateInputValue(period.effectiveFrom) : null };
}

export const reportPositions = [
  ['1a', 'Stand der Mobilen Reserve in Personen', 'people'],
  ['1b', 'Stand der Mobilen Reserve in Lehrerwochenstunden', 'hours'],
  ['2', 'Längerfristige Vertretungen (mehr als 4 Wochen)', 'long'],
  ['3', 'Kurzfristige Vertretungen', 'short'],
  ['4', 'Insgesamt im Einsatz', 'deployed'],
  ['5a', 'Nicht im Einsatz – Gesamtzahl', 'idle'],
  ['5b', 'Davon einsatzfähig', 'ready'],
] as const;
