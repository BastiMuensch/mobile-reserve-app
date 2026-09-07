export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { getSchoolYearForDate } from '@/lib/schoolYear';
import { isValidDateKey, parseDateKeyStrict } from '@/lib/dateKey';
import { normalizeLeaveRange } from '@/lib/leaveService';
import { createLeavePreviewToken } from '@/lib/leavePreviewToken';

/**
 * Read-only preflight for the leave form. The POST route remains the source of
 * truth; this endpoint exists solely to make the cancellation consequence clear
 * before the user confirms it.
 */
export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json() as { teacherId?: string; startDate?: string; endDate?: string | null };
    if (!body.startDate || !isValidDateKey(body.startDate) || (body.endDate != null && !isValidDateKey(body.endDate))) {
      return NextResponse.json({ error: 'Ungültiger Zeitraum.' }, { status: 400 });
    }

    const startDate = parseDateKeyStrict(body.startDate);
    const endDate = body.endDate ? parseDateKeyStrict(body.endDate) : null;
    if (!startDate || (body.endDate && !endDate)) return NextResponse.json({ error: 'Ungültiger Zeitraum.' }, { status: 400 });
    const { start, end } = normalizeLeaveRange(startDate, endDate);
    if (end && end < start) return NextResponse.json({ error: 'Das Ende darf nicht vor dem Beginn liegen.' }, { status: 400 });

    let teacher;
    if (session.role === 'TEACHER') {
      teacher = await prisma.teacher.findFirst({
        where: { userId: session.id, schoolYear: getSchoolYearForDate(start) },
        select: { id: true, userId: true },
      });
    } else if (session.role === 'SCHULAMT' && body.teacherId) {
      teacher = await prisma.teacher.findFirst({
        where: { id: body.teacherId, stammschule: { schulamtId: session.id } },
        select: { id: true, userId: true },
      });
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!teacher) return NextResponse.json({ error: 'Lehrkraft nicht gefunden.' }, { status: 404 });

    const teacherIds = teacher.userId
      ? (await prisma.teacher.findMany({ where: { userId: teacher.userId }, select: { id: true } })).map(item => item.id)
      : [teacher.id];
    const assignmentWhere = {
      teacherId: { in: teacherIds },
      status: { not: 'REJECTED' as const },
      date: end ? { gte: start, lte: end } : { gte: start },
    };
    const assignments = await prisma.assignment.findMany({
      where: assignmentWhere,
      select: { id: true, date: true, request: { select: { school: { select: { name: true } } } } },
      orderBy: { date: 'asc' },
    });
    const cancelledAssignments = assignments.length;

    return NextResponse.json({
      cancelledAssignments,
      previewToken: createLeavePreviewToken(teacherIds, start, end, assignments.map(assignment => assignment.id)),
      assignments: assignments.slice(0, 12).map(assignment => ({
        id: assignment.id,
        date: assignment.date,
        schoolName: assignment.request.school.name,
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Die Auswirkungen konnten nicht geprüft werden.' }, { status: 500 });
  }
}
