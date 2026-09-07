import { z } from 'zod';
import { isValidDateKey, toLocalDateInputValue } from '@/lib/dateKey';
import { schoolYearSchema } from '@/lib/schoolYear';

export const batchPlanningSchema = z.object({
  schoolYear: schoolYearSchema,
  until: z.string().refine(isValidDateKey, 'Erwartet wird ein gültiges Datum im Format JJJJ-MM-TT.'),
});

export type BatchPlanningWindow = { schoolYear: string; from: string; until: string };

/** Automatic planning never creates retrospective assignments. Compare calendar
 * keys, not server-local midnight timestamps (hosts may run in UTC). */
export function getBatchPlanningWindow(
  input: z.infer<typeof batchPlanningSchema>,
  now: Date = new Date(),
): BatchPlanningWindow {
  const { schoolYear, until } = batchPlanningSchema.parse(input);
  const [startYear, endYear] = schoolYear.split('/');
  const start = `${startYear}-09-01`;
  const end = `${endYear}-08-31`;
  const today = toLocalDateInputValue(now);
  if (today > end) throw new Error('Dieses Schuljahr ist abgeschlossen. Bitte ein aktuelles oder zukünftiges Schuljahr auswählen. Rückwirkende Einträge erfolgen über die Einzelzuweisung.');
  if (until < today) throw new Error('Der Stichtag darf nicht in der Vergangenheit liegen. Bitte neu berechnen.');
  if (until < start || until > end) throw new Error('Der Stichtag muss innerhalb des ausgewählten Schuljahres liegen.');
  return { schoolYear, from: today > start ? today : start, until };
}

export function areBatchEntriesInWindow(
  entries: { date: string }[], window: BatchPlanningWindow,
): boolean {
  return entries.every(entry => isValidDateKey(entry.date) && entry.date >= window.from && entry.date <= window.until);
}

export class BatchOvertimeConfirmationRequired extends Error {
  readonly warnings: string[];
  constructor(warnings: string[]) {
    super('Diese Freigabe enthält Mehrarbeit. Bitte die Wochenstunden prüfen und ausdrücklich bestätigen.');
    this.name = 'BatchOvertimeConfirmationRequired';
    this.warnings = [...new Set(warnings)];
  }
}

/** Must be called INSIDE the assignment transaction, after all segments have
 * been validated, so neither assignments nor outbox entries survive rejection. */
export function requireBatchOvertimeConsent(warnings: string[], allowOvertime: boolean): void {
  if (warnings.length > 0 && !allowOvertime) throw new BatchOvertimeConfirmationRequired(warnings);
}
