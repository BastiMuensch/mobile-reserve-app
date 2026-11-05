import { hasAssignmentBookingConflict, type BookingAssignment } from './assignmentBooking';

/** Client-only helpers for the stateless Idealbesetzung preview. */

export type BatchPlanEntry = { date: string; hours: number; lessonHours?: string | null };

export type BatchPlanSegment = {
  teacherId: string;
  entries: BatchPlanEntry[];
};

export type BatchPlanProposal = {
  requestId: string;
  segments: BatchPlanSegment[];
};

export type BatchPlanSchool = {
  schoolId: string;
  proposals: BatchPlanProposal[];
};

export type BatchPlanSwap = Record<string, { teacherId: string; teacherName: string }>;

export type ApprovalItem = {
  requestId: string;
  segments: { teacherId: string; entries: BatchPlanEntry[] }[];
};

export type ApprovalPayload = {
  schoolId: string;
  items: ApprovalItem[];
  schoolYear: string;
  until: string;
  allowOvertime?: boolean;
  expectedReserveShortageMode?: boolean;
};

export function batchPlanSegmentKey(requestId: string, segmentIndex: number): string {
  return `${requestId}:${segmentIndex}`;
}

/**
 * Returns incompatible selected bookings. A day remains locked to its school site;
 * distinct requests can share it only with proven disjoint lesson snapshots. Approved schools are deliberately excluded: their assignments are no
 * longer a mutable part of this preview and require a fresh calculation instead.
 */
export function findTentativeDuplicateTeacherDays(
  schools: BatchPlanSchool[],
  selected: Record<string, boolean>,
  swaps: BatchPlanSwap,
  approvedPayloads: ApprovalPayload[],
  locations: Record<string, { locationId?: string | null }> = {},
): Set<string> {
  const conflicts = new Set<string>();
  type Booking = { segmentKey?: string; assignment: BookingAssignment };
  const bookings = new Map<string, Booking[]>();
  const record = (teacherId: string, date: string, booking: Booking) => {
    const key = `${teacherId}:${date}`;
    const day = bookings.get(key) ?? [];
    day.push(booking);
    bookings.set(key, day);
  };
  for (const payload of approvedPayloads) {
    for (const item of payload.items) for (const segment of item.segments) for (const entry of segment.entries) {
      record(segment.teacherId, entry.date, { assignment: { ...entry, requestId: item.requestId,
        request: { schoolId: payload.schoolId, locationId: locations[item.requestId]?.locationId } } });
    }
  }
  const approvedSchoolIds = new Set(approvedPayloads.map(payload => payload.schoolId));
  for (const school of schools) {
    if (approvedSchoolIds.has(school.schoolId)) continue;
    for (const proposal of school.proposals) {
      if (!selected[proposal.requestId]) continue;
      for (const [segmentIndex, segment] of proposal.segments.entries()) {
        const segmentKey = batchPlanSegmentKey(proposal.requestId, segmentIndex);
        const teacherId = swaps[segmentKey]?.teacherId ?? segment.teacherId;
        for (const entry of segment.entries) {
          // A swap can change a part-time reserve's lesson selection. A fresh
          // preview supplies its new snapshot; never reuse another teacher's.
          const lessonHours = teacherId === segment.teacherId && locations[proposal.requestId] ? entry.lessonHours : null;
          const proposed = { ...entry, lessonHours, requestId: proposal.requestId,
            schoolId: school.schoolId, locationId: locations[proposal.requestId]?.locationId };
          for (const prior of bookings.get(`${teacherId}:${entry.date}`) ?? []) {
            if (hasAssignmentBookingConflict([prior.assignment], proposed)) {
              conflicts.add(segmentKey);
              if (prior.segmentKey) conflicts.add(prior.segmentKey);
            }
          }
          record(teacherId, entry.date, { segmentKey, assignment: { ...proposed,
            request: { schoolId: school.schoolId, locationId: proposed.locationId } } });
        }
      }
    }
  }
  return conflicts;
}

export function makeApprovalPayload(
  school: BatchPlanSchool,
  selected: Record<string, boolean>,
  swaps: BatchPlanSwap,
  schoolYear: string,
  until: string,
): ApprovalPayload {
  return {
    schoolId: school.schoolId,
    schoolYear,
    until,
    items: school.proposals.filter(proposal => selected[proposal.requestId]).map(proposal => ({
      requestId: proposal.requestId,
      segments: proposal.segments.flatMap((segment, segmentIndex) => segment.entries.length === 0 ? [] : [{
        teacherId: swaps[batchPlanSegmentKey(proposal.requestId, segmentIndex)]?.teacherId ?? segment.teacherId,
        entries: segment.entries,
      }]),
    })),
  };
}

/** Keep the effective checked choices; unchecked needs deliberately release capacity. */
export function makeRecalculationPayload(input: {
  schools: BatchPlanSchool[];
  selected: Record<string, boolean>;
  swaps: BatchPlanSwap;
  approvedPayloads: ApprovalPayload[];
  excludedRequestIds: string[];
  schoolYear: string;
  until: string;
  expectedReserveShortageMode: boolean;
  reconsiderRequestId?: string;
}) {
  const approvedSchoolIds = new Set(input.approvedPayloads.map(payload => payload.schoolId));
  const approvedRequestIds = new Set(input.approvedPayloads.flatMap(payload => payload.items.map(item => item.requestId)));
  const excluded = new Set(input.excludedRequestIds.filter(id => !approvedRequestIds.has(id)));
  const retainedItems: ApprovalItem[] = [];
  for (const school of input.schools) {
    for (const proposal of school.proposals) {
      if (!approvedRequestIds.has(proposal.requestId) && input.selected[proposal.requestId] === false) excluded.add(proposal.requestId);
    }
    // The whole school card is frozen after approval. Actual assignments are now
    // authoritative; do not reserve those same teachers a second time.
    if (approvedSchoolIds.has(school.schoolId)) continue;
    retainedItems.push(...makeApprovalPayload(school, input.selected, input.swaps, input.schoolYear, input.until).items);
  }
  for (const item of retainedItems) excluded.delete(item.requestId);
  if (input.reconsiderRequestId) excluded.delete(input.reconsiderRequestId);
  return {
    schoolYear: input.schoolYear,
    until: input.until,
    expectedReserveShortageMode: input.expectedReserveShortageMode,
    retainedItems,
    excludedRequestIds: [...excluded],
  };
}
