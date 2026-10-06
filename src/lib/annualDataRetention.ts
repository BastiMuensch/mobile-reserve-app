import type { Prisma } from '@prisma/client';
import { toCanonicalUtcDate } from './dateKey';
import { getSchoolYearForDate, schoolYearSchema } from './schoolYear';

/** Whole school years expire 400 calendar days after their last day. */
export function annualRetentionBoundary(now: Date): Date {
  const cutoff = toCanonicalUtcDate(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 400);
  const startYear = getSchoolYearForDate(cutoff).split('/')[0];
  return new Date(`${startYear}-09-01T00:00:00.000Z`);
}

export function isExpiredSchoolYear(year: string, boundary: Date): boolean {
  if (!schoolYearSchema.safeParse(year).success) return false;
  return new Date(`${year.split('/')[1]}-09-01T00:00:00.000Z`) <= boundary;
}

export async function deleteExpiredAnnualData(tx: Prisma.TransactionClient, now: Date) {
  const boundary = annualRetentionBoundary(now);
  const years = await tx.teacher.findMany({ distinct: ['schoolYear'], select: { schoolYear: true } });
  const expiredYears = years.map(row => row.schoolYear).filter(year => isExpiredSchoolYear(year, boundary));

  const reports = await tx.governmentReport.deleteMany({ where: { date: { lt: boundary } } });
  // Dependent rows remaining after ordinary cleanup retain their profile. In
  // particular, an open leave must keep blocking copied current-year profiles.
  const eligible = {
    schoolYear: { in: expiredYears },
    assignments: { none: {} },
    absences: { none: {} },
    leavePeriods: { none: {} },
  } satisfies Prisma.TeacherWhereInput;
  const candidates = await tx.teacher.findMany({ where: eligible, select: { id: true, userId: true } });
  const profiles = await tx.teacher.deleteMany({ where: { ...eligible, id: { in: candidates.map(row => row.id) } } });
  // Reporting periods cascade with the profile. Shared logins and all other
  // roles remain; only now-unreferenced teacher logins from this batch expire.
  const users = await tx.user.deleteMany({ where: {
    id: { in: candidates.flatMap(row => row.userId ? [row.userId] : []) },
    role: 'TEACHER', teachers: { none: {} },
  } });
  return { deletedGovernmentReports: reports.count, deletedTeacherProfiles: profiles.count, deletedTeacherAccounts: users.count };
}
