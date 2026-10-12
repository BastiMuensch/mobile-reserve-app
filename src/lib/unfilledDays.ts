import { isValidDateKey } from '@/lib/dateKey';

/** Each decision concerns one calendar day; reversals remain in the history. */
export type UnfilledDayDecision = {
  date: string;
  reason: string | null;
  decidedAt: string;
  revertedAt?: string | null;
};

function isDecision(value: unknown): value is UnfilledDayDecision {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return isValidDateKey(entry.date)
    && (entry.reason === null || typeof entry.reason === 'string')
    && typeof entry.decidedAt === 'string' && !Number.isNaN(Date.parse(entry.decidedAt))
    && (entry.revertedAt == null || (typeof entry.revertedAt === 'string' && !Number.isNaN(Date.parse(entry.revertedAt))));
}

export function isValidUnfilledDaysJson(raw: string): boolean {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every(isDecision);
  } catch {
    return false;
  }
}

export function parseUnfilledDays(raw?: string | null): UnfilledDayDecision[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isDecision) : [];
  } catch {
    return [];
  }
}

export function activeUnfilledDays(raw?: string | null): UnfilledDayDecision[] {
  return parseUnfilledDays(raw).filter(entry => !entry.revertedAt).sort((a, b) => a.date.localeCompare(b.date));
}

/** Remove free text without changing refusal dates, reversals or other metadata. */
export function redactUnfilledReasons(raw: string): { value: string; count: number } {
  if (!isValidUnfilledDaysJson(raw)) {
    throw new Error('Absagehistorie kann nicht sicher bereinigt werden.');
  }
  const history = JSON.parse(raw) as UnfilledDayDecision[];
  let count = 0;
  const redacted = history.map(day => {
    if (day.reason === null) return day;
    count += 1;
    return { ...day, reason: null };
  });
  return { value: count ? JSON.stringify(redacted) : raw, count };
}
