import { createHash } from 'crypto';

/** Stable, non-secret optimistic-concurrency token for a leave preview. */
export function createLeavePreviewToken(teacherIds: string[], start: Date, end: Date | null, assignmentIds: string[]) {
  return createHash('sha256').update([
    ...teacherIds.slice().sort(), start.toISOString(), end?.toISOString() ?? 'open', ...assignmentIds.slice().sort(),
  ].join('|')).digest('hex');
}
