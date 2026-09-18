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
      id: true, name: true, maxWeeklyHours: true, status: true, schedule: true,
      reportingPeriods: { orderBy: { effectiveFrom: 'desc' } },
      absences: { where: { date: { gte: start, lte: end } }, select: { date: true } },
      leavePeriods: { select: { startDate: true, endDate: true } },
      assignments: {
        where: { date: { gte: start, lte: end }, request: { school: { schulamtId } } },
        select: { date: true, hours: true, status: true, requestId: true,
          request: { select: { status: true, date: true, endDate: true, isOpenEnded: true } } },
      },
    },
  });
  return teachers.map(teacher => suggestReportingRow(teacher, date));
}
