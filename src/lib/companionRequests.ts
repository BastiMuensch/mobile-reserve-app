import { rankCandidates, isActiveMatchingAssignment } from './matching';
import { getOpenRequestDays, getRequestCoverageStatus } from './requestDays';
import { resolveAssignmentLessonHours } from './assignmentTiming';
import { toLocalDateInputValue } from './dateKey';

export type CompanionRequestOption = {
  requestId: string;
  substitutedTeacher: string;
  className?: string | null;
  entries: { date: string; hours: number; lessonHours: string }[];
  isOvertime: boolean;
};

type MatchRequest = Parameters<typeof rankCandidates>[0];
type MatchTeacher = Parameters<typeof rankCandidates>[2][number];

/** Offer a mutually compatible package. Every addition is checked again by the
 * assignment transaction; manually approved exceptions never carry into extras. */
export function companionRequestsForTeacher(input: {
  anchor: MatchRequest;
  candidate: ReturnType<typeof rankCandidates>[number];
  teacher: MatchTeacher;
  requests: MatchRequest[];
  school: Parameters<typeof rankCandidates>[1];
  absences: Parameters<typeof rankCandidates>[3];
  leaves: Parameters<typeof rankCandidates>[4];
}): CompanionRequestOption[] {
  const { anchor, candidate, school, absences, leaves } = input;
  const teacher = { ...input.teacher, assignments: [...input.teacher.assignments] };
  const eligible = new Set(candidate.eligibleDateKeys ?? []);
  const anchors = getOpenRequestDays(anchor, anchor.assignments).filter(day => eligible.has(day.date));
  const entriesFor = (request: MatchRequest, date: string, hours: number) => {
    const lessonHours = resolveAssignmentLessonHours({ request, teacher, date, hours,
      existing: (request.assignments ?? []).filter(a => isActiveMatchingAssignment(a)
        && toLocalDateInputValue(new Date(a.date)) === date),
    });
    return { date, hours, lessonHours };
  };
  const book = (request: MatchRequest, entry: { date: string; hours: number; lessonHours: string }) => {
    teacher.assignments.push({ ...entry, date: new Date(entry.date), status: 'PENDING', requestId: request.id,
      request: { schoolId: request.schoolId, locationId: request.locationId, status: request.status } });
  };
  const dates: string[] = [];
  for (const day of anchors) {
    const hours = Math.min(day.hours, candidate.availableHoursByDate?.[day.date] ?? 0);
    const entry = entriesFor(anchor, day.date, hours);
    if (hours > 0 && entry.lessonHours) {
      dates.push(day.date);
      book(anchor, { ...entry, lessonHours: entry.lessonHours });
    }
  }
  const options: CompanionRequestOption[] = [];
  for (const request of input.requests) {
    if (options.length >= 20) break;
    if (request.id === anchor.id || request.schoolId !== anchor.schoolId
      || (request.locationId ?? null) !== (anchor.locationId ?? null)) continue;
    const current = { ...request, status: getRequestCoverageStatus(request, request.assignments) };
    const [match] = rankCandidates(current, school, [teacher], absences, leaves, dates);
    if (!match || match.suitability.level !== 'MATCH') continue;
    const entries = getOpenRequestDays(current, current.assignments)
      .filter(day => dates.includes(day.date) && (match.availableHoursByDate?.[day.date] ?? 0) >= day.hours)
      .map(day => entriesFor(current, day.date, day.hours))
      .filter((entry): entry is CompanionRequestOption['entries'][number] => Boolean(entry.lessonHours));
    if (!entries.length) continue;
    entries.forEach(entry => book(current, entry));
    options.push({ requestId: request.id, substitutedTeacher: request.substitutedTeacher,
      className: request.className, entries, isOvertime: match.isOvertime === true });
  }
  return options;
}

/** Only displayed anchor days with their original hours may carry suggestions.
 * Changing hours requires a fresh search instead of silently moving lesson slots. */
export function selectedCompanionEntries(
  option: CompanionRequestOption,
  assignments: { date: string; hours: string; selected: boolean; suggestedHours?: number }[],
) {
  return option.entries.filter(entry => assignments.some(anchor => anchor.selected && anchor.date === entry.date
    && Number(anchor.hours) === anchor.suggestedHours));
}
