import type { BatchPlanEntry } from './batchPlanClient';

type RejectionProposal = {
  requestId: string;
  segments: { entries: BatchPlanEntry[] }[];
  coverage: { assignedHours: number; requiredHours: number; cancelledHours?: number };
};

type RejectionSchool = {
  proposals: RejectionProposal[];
  unfillable: { requestId: string; reason: string }[];
  coverage: { filledRequests: number; totalRequests: number; assignedHours: number; requiredHours: number; cancelledHours?: number };
};

/** Only server-provided, still-open days inside this preview may be refused. */
export function batchRejectionDays(openDays: BatchPlanEntry[], scope: string): BatchPlanEntry[] {
  return openDays.filter(day => scope === 'all' || day.date === scope);
}

/** Selected proposals and already approved proposals must never become refusals. */
export function canRejectBatchRequest(
  school: RejectionSchool,
  requestId: string,
  selected: Record<string, boolean>,
  approvedRequestIds: Set<string>,
): boolean {
  if (approvedRequestIds.has(requestId)) return false;
  if (school.proposals.some(proposal => proposal.requestId === requestId)) return selected[requestId] === false;
  return school.unfillable.some(entry => entry.requestId === requestId);
}

/** Preserve a deliberate deselection even when refusal removes its last segment. */
export function updateBatchExclusionsAfterRejection(
  excludedRequestIds: string[],
  requestId: string,
  remainingDays: BatchPlanEntry[],
  wasDeselected: boolean,
): string[] {
  const excluded = new Set(excludedRequestIds);
  if (remainingDays.length === 0) excluded.delete(requestId);
  else if (wasDeselected) excluded.add(requestId);
  return [...excluded];
}

/**
 * Apply a committed refusal to this snapshot without resetting other selections.
 * Empty segments stay in place so index-keyed teacher swaps never migrate to a
 * different segment. Approval serialization omits those empty segments.
 */
export function applyBatchRejection<T extends RejectionSchool>(
  school: T,
  requestId: string,
  refusedDates: string[],
  openDays: BatchPlanEntry[],
  reserveShortageMode: boolean,
): T {
  const refused = new Set(refusedDates);
  const remainingDays = openDays.filter(day => !refused.has(day.date));
  const removedHours = openDays.filter(day => refused.has(day.date)).reduce((sum, day) => sum + day.hours, 0);
  const requiredHours = remainingDays.reduce((sum, day) => sum + day.hours, 0);
  let hasRemainingProposal = false;
  const proposals = school.proposals.flatMap(proposal => {
    if (proposal.requestId !== requestId) return [proposal];
    const segments = proposal.segments.map(segment => ({
      ...segment, entries: segment.entries.filter(entry => !refused.has(entry.date)),
    }));
    const assignedByDate = new Map<string, number>();
    for (const segment of segments) {
      for (const entry of segment.entries) assignedByDate.set(entry.date, (assignedByDate.get(entry.date) ?? 0) + entry.hours);
    }
    const assignedHours = [...assignedByDate.values()].reduce((sum, hours) => sum + hours, 0);
    if (assignedHours === 0) return [];
    hasRemainingProposal = true;
    const cancelledHours = reserveShortageMode
      ? remainingDays.reduce((sum, day) => sum + (assignedByDate.has(day.date) ? Math.max(0, day.hours - assignedByDate.get(day.date)!) : 0), 0)
      : 0;
    return [{ ...proposal, segments, coverage: { ...proposal.coverage, assignedHours, requiredHours, cancelledHours } }];
  });
  const unfillable = school.unfillable.filter(entry => entry.requestId !== requestId);
  if (remainingDays.length > 0 && !hasRemainingProposal) {
    unfillable.push(school.unfillable.find(entry => entry.requestId === requestId) ?? {
      requestId, reason: 'Für die verbleibenden Tage liegt kein Besetzungsvorschlag vor. Bitte neu berechnen.',
    });
  }
  return {
    ...school,
    proposals,
    unfillable,
    coverage: {
      ...school.coverage,
      totalRequests: proposals.length + unfillable.length,
      filledRequests: proposals.filter(proposal => proposal.coverage.assignedHours + (proposal.coverage.cancelledHours ?? 0) >= proposal.coverage.requiredHours).length,
      assignedHours: proposals.reduce((sum, proposal) => sum + proposal.coverage.assignedHours, 0),
      requiredHours: Math.max(0, school.coverage.requiredHours - removedHours),
      cancelledHours: proposals.reduce((sum, proposal) => sum + (proposal.coverage.cancelledHours ?? 0), 0),
    },
  };
}
