import { schoolYearSchema } from "@/lib/schoolYear";
import { parseDateKeyStrict, toCanonicalUtcDate } from "@/lib/dateKey";

/**
 * A single copy request is deliberately small.  The dialog splits larger
 * selections into these independently retriable requests, keeping the
 * serializable transaction short even for very large Schulämter.
 */
export const MAX_TEACHERS_PER_COPY_BATCH = 500;

export type ExistingTeacherIdentity = {
  userId: string | null;
  email: string | null;
  name: string;
  stammschuleId: string;
};

export type TeacherIdentityInYear = ExistingTeacherIdentity & {
  schoolYear: string;
};

export type CopyableLeavePeriod = {
  startDate: Date;
  endDate: Date | null;
  reportedBy: string;
};

function normalizeIdentityPart(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
}

export function identityKeys(teacher: ExistingTeacherIdentity): string[] {
  const keys: string[] = [];
  if (teacher.userId) keys.push(`user:${teacher.userId}`);
  if (teacher.email) keys.push(`email:${normalizeIdentityPart(teacher.email)}`);

  // Name + Stammschule is a fallback exclusively for records without a login
  // and email address.  Otherwise equal names must not turn distinct people
  // into accidental duplicates.
  if (keys.length === 0) {
    keys.push(`name-school:${normalizeIdentityPart(teacher.name)}:${teacher.stammschuleId}`);
  }
  return keys;
}

/**
 * Keep the target-year constraint both in the database query and here.  The
 * second check is cheap defence in depth: a later query refactor cannot cause
 * a teacher from another school year to suppress a valid copy candidate.
 */
export function existingIdentityKeysForTargetYear(
  teachers: TeacherIdentityInYear[],
  targetYear: string,
): Set<string> {
  return new Set(
    teachers
      .filter(teacher => teacher.schoolYear === targetYear)
      .flatMap(identityKeys),
  );
}

/** Uses strict YYYY-MM-DD calendar days, not Date string parsing. */
export function schoolYearDayBounds(schoolYear: string): { start: Date; end: Date } {
  const parsed = schoolYearSchema.safeParse(schoolYear);
  if (!parsed.success) throw new Error("Ungültiges Schuljahr.");

  const [startYear, endYear] = schoolYear.split("/");
  return {
    start: parseDateKeyStrict(`${startYear}-09-01`),
    end: parseDateKeyStrict(`${endYear}-08-31`),
  };
}

function canonicalStoredDay(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Ungültiges gespeichertes Datum in einer Langzeitabwesenheit.");
  }
  return toCanonicalUtcDate(value);
}

/**
 * Produces the part of a leave period that is relevant to the target school
 * year.  A long leave beginning in the source year therefore starts on 1
 * September on the copied target record, while open-ended leaves stay open.
 * This works with the current schema and avoids misleading pre-year dates in
 * the target-year record.
 */
export function clampLeaveToTargetSchoolYear(
  leave: CopyableLeavePeriod,
  targetYear: string,
): CopyableLeavePeriod | null {
  const { start: targetStart, end: targetEnd } = schoolYearDayBounds(targetYear);
  const startDate = canonicalStoredDay(leave.startDate);
  const endDate = leave.endDate ? canonicalStoredDay(leave.endDate) : null;

  if (endDate && endDate < startDate) {
    throw new Error("Ungültiger gespeicherter Zeitraum einer Langzeitabwesenheit.");
  }
  if (startDate > targetEnd || (endDate && endDate < targetStart)) return null;

  return {
    startDate: startDate < targetStart ? targetStart : startDate,
    endDate: endDate && endDate > targetEnd ? targetEnd : endDate,
    reportedBy: leave.reportedBy,
  };
}
