import { z } from 'zod';
import { isValidDateKey, toLocalDateInputValue } from '@/lib/dateKey';
import { schoolYearSchema } from '@/lib/schoolYear';

export const batchPlanningSchema = z.object({
  schoolYear: schoolYearSchema,
  until: z.string().refine(isValidDateKey, 'Erwartet wird ein gültiges Datum im Format JJJJ-MM-TT.'),
});

export const batchPreviewSchema = batchPlanningSchema.extend({
  expectedReserveShortageMode: z.boolean().optional(),
  retainedItems: z.array(z.object({
    requestId: z.string().uuid('Ungültige Anforderungs-Kennung.'),
    segments: z.array(z.object({
      teacherId: z.string().uuid('Ungültige Lehrkraft-Kennung.'),
      entries: z.array(z.object({
        date: z.string().refine(isValidDateKey, 'Ungültiger Einsatztag.'),
        hours: z.number().int().positive().max(24),
      })).min(1).max(400),
    })).min(1).max(400),
  })).max(1000).default([]),
  excludedRequestIds: z.array(z.string().uuid('Ungültige Anforderungs-Kennung.')).max(1000).default([]),
}).superRefine((input, context) => {
  const retained = input.retainedItems.map(item => item.requestId);
  if (new Set(retained).size !== retained.length || new Set(input.excludedRequestIds).size !== input.excludedRequestIds.length) {
    context.addIssue({ code: 'custom', message: 'Eine Anforderung darf nur einmal angegeben werden.' });
  }
  if (input.excludedRequestIds.some(id => retained.includes(id))) {
    context.addIssue({ code: 'custom', message: 'Eine Anforderung kann nicht gleichzeitig beibehalten und zurückgestellt werden.' });
  }
  if (input.retainedItems.reduce((sum, item) => sum + item.segments.reduce((count, segment) => count + segment.entries.length, 0), 0) > 20_000) {
    context.addIssue({ code: 'custom', message: 'Die beizubehaltende Auswahl ist zu groß.' });
  }
});

export type RetainedBatchItem = z.infer<typeof batchPreviewSchema>['retainedItems'][number];

/** Read-only recalculation rejects stale fixed selections without altering them. */
export class RetainedBatchSelectionConflict extends Error {
  constructor(detail: string) {
    super(`${detail} Ihre bisherige Auswahl wurde nicht verändert. Bitte prüfen oder alles neu planen.`);
    this.name = 'RetainedBatchSelectionConflict';
  }
}

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
