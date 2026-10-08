import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCurrentSchoolYear, getSchoolYearDates, schoolYearSchema } from '@/lib/schoolYear';
import { buildWorkloadReport } from '@/lib/workload';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const year = schoolYearSchema.safeParse(new URL(request.url).searchParams.get('year') ?? getCurrentSchoolYear());
  if (!year.success) return NextResponse.json({ error: 'Ungültiges Schuljahr.' }, { status: 400 });
  try {
    const { start, end } = getSchoolYearDates(year.data);
    const teachers = await prisma.teacher.findMany({
      where: { schoolYear: year.data, status: { not: 'PENDING' }, stammschule: { schulamtId: user.id } },
      select: {
        id: true, name: true, maxWeeklyHours: true, stammschule: { select: { name: true } },
        assignments: {
          where: { status: { in: ['PENDING', 'ACCEPTED'] }, date: { gte: start, lte: end }, request: { status: { not: 'CANCELLED' }, school: { schulamtId: user.id } } },
          select: { date: true, hours: true, status: true },
        },
      },
    });
    return NextResponse.json(buildWorkloadReport(year.data, teachers), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Stundenübersicht konnte nicht geladen werden:', error);
    return NextResponse.json({ error: 'Die Stundenübersicht konnte nicht geladen werden.' }, { status: 500 });
  }
}
