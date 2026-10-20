import { requestLessonHoursForDay, scheduledLessonHoursForDay } from './requestTiming';

type AssignmentTiming = { hours: number; lessonHours?: string | null };

/** A missing snapshot is intentionally unknown, especially for legacy partial assignments. */
export function assignmentLessonHours(assignment: AssignmentTiming): number[] | null {
  if (!assignment.lessonHours) return null;
  try {
    const hours: unknown = JSON.parse(assignment.lessonHours);
    if (!Array.isArray(hours) || hours.length !== assignment.hours || hours.length === 0
      || !hours.every(hour => typeof hour === 'number' && Number.isInteger(hour) && hour >= 1 && hour <= 10)
      || new Set(hours).size !== hours.length) return null;
    return [...hours].sort((a, b) => a - b);
  } catch {
    return null;
  }
}

export function assignmentStartHour(assignment: AssignmentTiming): number | null {
  return assignmentLessonHours(assignment)?.[0] ?? null;
}

export function assignmentStartLabel(assignment: AssignmentTiming): string {
  const start = assignmentStartHour(assignment);
  return start === null ? 'Beginn bitte mit der Schule abstimmen' : `ab ${start}. Std.`;
}

/**
 * Pick actual remaining lessons at approval time and persist the result. Changes
 * to the teacher's or request's timetable later must not move an accepted start.
 * Legacy assignments have no slot evidence; never guess their occupied lessons.
 */
export function resolveAssignmentLessonHours(input: {
  request: { hours: number; startHour?: number | null; schedule?: string | null };
  teacher: { isPartTime: boolean; schedule?: string | null };
  date: Date | string;
  hours: number;
  existing: AssignmentTiming[];
  allowTimetableOverride?: boolean;
}): string | null {
  const required = requestLessonHoursForDay(input.request, input.date);
  if (!required?.length) return null;
  const occupied = new Set<number>();
  for (const assignment of input.existing) {
    const slots = assignmentLessonHours(assignment);
    if (!slots) return null;
    for (const hour of slots) occupied.add(hour);
  }
  const remaining = required.filter(hour => !occupied.has(hour));
  const teacherSlots = input.teacher.isPartTime
    ? new Set(input.teacher.schedule ? scheduledLessonHoursForDay(input.teacher.schedule, input.date) ?? [] : [])
    : new Set(required);
  const regular = remaining.filter(hour => teacherSlots.has(hour));
  const eligible = input.allowTimetableOverride
    ? [...regular, ...remaining.filter(hour => !teacherSlots.has(hour))]
    : regular;
  if (eligible.length < input.hours) return null;
  return JSON.stringify(eligible.slice(0, input.hours).sort((a, b) => a - b));
}
