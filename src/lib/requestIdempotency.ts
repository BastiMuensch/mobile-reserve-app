import { z } from "zod";
import { createHash } from "crypto";

/**
 * A UUID supplied by the school client for exactly one submission attempt.
 * The database uniqueness constraint scopes it to a school, so equal request
 * contents remain valid independent requests when they use distinct keys.
 */
export const requestIdempotencyKeySchema = z.uuid("Ungültiger Anforderungs-Schlüssel.");

export type NormalizedRequestAttempt = {
  schoolId: string;
  date: Date;
  endDate: Date | null;
  priority: string;
  startHour: number;
  hours: number;
  weeklyHours: number;
  schoolType: string;
  substitutedTeacher: string;
  schedule: string | null;
  qualifications: string;
  comments: string | null;
  isOpenEnded: boolean;
};

/**
 * Deterministic hash of exactly the data that affects the persisted demand.
 * The explicit field order avoids relying on caller object insertion order.
 */
export function requestAttemptFingerprint(attempt: NormalizedRequestAttempt): string {
  const canonical = JSON.stringify([
    attempt.schoolId,
    attempt.date.toISOString(),
    attempt.endDate?.toISOString() ?? null,
    attempt.priority,
    attempt.startHour,
    attempt.hours,
    attempt.weeklyHours,
    attempt.schoolType,
    attempt.substitutedTeacher,
    attempt.schedule,
    attempt.qualifications,
    attempt.comments,
    attempt.isOpenEnded,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Historic rows without a fingerprint are never safe to replay by key. */
export function matchesRequestIdempotencyFingerprint(stored: string | null | undefined, expected: string): boolean {
  return typeof stored === 'string' && stored.length > 0 && stored === expected;
}
