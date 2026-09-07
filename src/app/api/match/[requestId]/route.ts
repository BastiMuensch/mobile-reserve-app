import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rankCandidates, toLocalDayStart } from '@/lib/matching';
import { getSessionUser } from '@/lib/auth';
import { getSchoolYearForDate } from '@/lib/schoolYear';
import { getOpenRequestDays } from '@/lib/requestDays';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { requestId } = await params;

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { school: true, assignments: { select: { date: true, hours: true, status: true } } },
    });

    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Security: ensure the request belongs to this Schulamt
    if (request.school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only load teachers from THIS Schulamt's schools
    const openDateKeys = getOpenRequestDays(request, request.assignments).map(day => day.date);
    const requestSchoolYears = Array.from(new Set(
      openDateKeys.map(day => {
        const [year, month, date] = day.split('-').map(Number);
        return getSchoolYearForDate(new Date(year, month - 1, date));
      })
    ));
    const allTeachers = await prisma.teacher.findMany({
      where: {
        stammschule: { schulamtId: userSession.id },
        schoolYear: { in: requestSchoolYears },
      },
      include: { assignments: { select: { hours: true, date: true, status: true } } },
    });

    // Reported absences of these teachers, so unavailable days can be excluded from matching
    const teacherIds = allTeachers.map(t => t.id);
    const userIds = allTeachers.map(t => t.userId).filter((id): id is string => Boolean(id));
    const userToTeacherIds = new Map<string, string[]>();
    for (const t of allTeachers) {
      if (t.userId) {
        const list = userToTeacherIds.get(t.userId);
        if (list) list.push(t.id);
        else userToTeacherIds.set(t.userId, [t.id]);
      }
    }

    const absences = await prisma.absence.findMany({
      where: { teacherId: { in: teacherIds } },
      select: { teacherId: true, date: true },
    });

    // Längere Abwesenheiten (Mutterschutz, Elternzeit, ...). Personenbezogen über alle Schuljahre
    const periodStart = toLocalDayStart(request.date);
    const rawLeaves = await prisma.leavePeriod.findMany({
      where: {
        OR: [
          { teacherId: { in: teacherIds } },
          ...(userIds.length > 0 ? [{ teacher: { userId: { in: userIds } } }] : []),
        ],
        AND: [
          { OR: [{ endDate: null }, { endDate: { gte: periodStart } }] },
        ],
      },
      select: {
        teacherId: true,
        startDate: true,
        endDate: true,
        teacher: { select: { userId: true } },
      },
    });

    const leavePeriods: { teacherId: string; startDate: Date; endDate: Date | null }[] = [];
    for (const l of rawLeaves) {
      if (teacherIds.includes(l.teacherId)) {
        leavePeriods.push({ teacherId: l.teacherId, startDate: l.startDate, endDate: l.endDate });
      }
      if (l.teacher?.userId && userToTeacherIds.has(l.teacher.userId)) {
        for (const tid of userToTeacherIds.get(l.teacher.userId)!) {
          if (tid !== l.teacherId) {
            leavePeriods.push({ teacherId: tid, startDate: l.startDate, endDate: l.endDate });
          }
        }
      }
    }

    const ranked = rankCandidates(request, request.school, allTeachers, absences, leavePeriods, openDateKeys);
    return NextResponse.json({ request, candidates: ranked });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to match candidates' }, { status: 500 });
  }
}
