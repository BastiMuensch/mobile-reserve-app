import type { Prisma } from '@prisma/client';
import { getSchoolYearDates, getSchoolYearForDate } from './schoolYear';
import { parseDateKeyStrict } from './dateKey';
import { suggestReportingRow } from './governmentReport';

export async function loadGovernmentReportRows(tx: Prisma.TransactionClient, schulamtId: string, date: string) {
  const year = getSchoolYearForDate(parseDateKeyStrict(date));
  const { start, end } = getSchoolYearDates(year);
  const teachers = await tx.teacher.findMany({
    where: { stammschule: { schulamtId }, schoolYear: year, status: { not: 'PENDING' } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      id: true, userId: true, name: true, maxWeeklyHours: true, status: true, schedule: true,
      reportingPeriods: { orderBy: { effectiveFrom: 'desc' } },
      absences: { where: { date: { gte: start, lte: end } }, select: { date: true } },
      leavePeriods: { select: { startDate: true, endDate: true } },
      assignments: {
        where: { date: { gte: start, lte: end }, request: { school: { schulamtId } } },
        select: { date: true, hours: true, actualHours: true, actualAdditionalMinutes: true, status: true, requestId: true,
          request: { select: { status: true, date: true, endDate: true, isOpenEnded: true } } },
      },
    },
  });
  // A login represents the same person across school years. Copying a profile
  // deliberately keeps its leave on the original row instead of duplicating it.
  const userIds = [...new Set(teachers.flatMap(teacher => teacher.userId ? [teacher.userId] : []))];
  const sharedLeaves = userIds.length > 0 ? await tx.leavePeriod.findMany({
    where: { teacher: { userId: { in: userIds } } },
    select: { startDate: true, endDate: true, teacher: { select: { userId: true } } },
  }) : [];
  const leavesByUserId = new Map<string, { startDate: Date; endDate: Date | null }[]>();
  for (const leave of sharedLeaves) {
    const userId = leave.teacher.userId!;
    const leaves = leavesByUserId.get(userId) ?? [];
    leaves.push({ startDate: leave.startDate, endDate: leave.endDate });
    leavesByUserId.set(userId, leaves);
  }
  return teachers.map(teacher => suggestReportingRow({
    ...teacher,
    leavePeriods: teacher.userId ? leavesByUserId.get(teacher.userId) ?? [] : teacher.leavePeriods,
  }, date));
}
