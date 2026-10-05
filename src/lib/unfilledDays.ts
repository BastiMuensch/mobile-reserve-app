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
