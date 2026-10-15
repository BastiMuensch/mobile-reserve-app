import { isValidDateKey, parseDateKeyStrict, toLocalDateInputValue } from '@/lib/dateKey';
import type { RequestData } from '@/types/models';

export type UnfilledHistoryEntry = {
  req: RequestData;
  date?: string;
  reason?: string | null;
  decidedAt?: string | null;
};

function dayKey(value: string): string | null {
  if (isValidDateKey(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : toLocalDateInputValue(date);
}

/** Display-only partition: original requests and all assignment details stay intact. */
export function partitionRequestHistory(
  assignedRequests: RequestData[],
  unfilledEntries: UnfilledHistoryEntry[],
  now: Date = new Date(),
) {
  const today = toLocalDateInputValue(now);
  const cutoffDate = parseDateKeyStrict(today);
  // Today plus six preceding calendar days, including across DST changes.
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 6);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  const recent = { assigned: [] as RequestData[], unfilled: [] as UnfilledHistoryEntry[] };
  const archive = { assigned: [] as RequestData[], unfilled: [] as UnfilledHistoryEntry[] };

  for (const request of assignedRequests) {
    const end = dayKey(request.endDate || request.date);
    const ongoing = (request.isOpenEnded && !request.endDate) || end === null || end >= today;
    const hasRecentAssignment = request.assignments.some(assignment => {
      if (assignment.status === 'REJECTED' || assignment.status === 'CANCELLED') return false;
      const date = dayKey(assignment.date);
      return date === null || date >= cutoff;
    });
    (ongoing || hasRecentAssignment ? recent : archive).assigned.push(request);
  }

  for (const entry of unfilledEntries) {
    // Legacy refusals concern the whole request; newer ones concern a single day.
    const ongoing = !entry.date && entry.req.isOpenEnded && !entry.req.endDate;
    const date = dayKey(entry.date || entry.req.endDate || entry.req.date);
    (ongoing || date === null || date >= cutoff ? recent : archive).unfilled.push(entry);
  }

  return { recent, archive, cutoff };
}
