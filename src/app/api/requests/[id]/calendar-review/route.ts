import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { toLocalDateInputValue } from '@/lib/dateKey';
import { prisma } from '@/lib/prisma';
import { assignmentCalendarWarning } from '@/lib/schoolCalendar';

const reviewInput = z.object({
  assignmentIds: z.array(z.string().min(1).max(200)).min(1).max(5000),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403 });

  const parsed = reviewInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bitte geben Sie gültige Zuweisungen an.' }, { status: 400 });

  const { id } = await params;
  const today = toLocalDateInputValue();
  const assignmentIds = [...new Set(parsed.data.assignmentIds)];
  const ownedRequest = { id, school: { schulamtId: user.id } };

  try {
    const demand = await prisma.request.findFirst({
      where: ownedRequest,
      select: {
        assignments: {
          where: { id: { in: assignmentIds } },
          select: { id: true, date: true, status: true },
        },
      },
    });
    if (!demand || demand.assignments.length !== assignmentIds.length) {
      return NextResponse.json({ error: 'Bedarf oder Zuweisung nicht gefunden.' }, { status: 404 });
    }

    const reviewedAssignmentIds = demand.assignments
      .filter(assignment => assignmentCalendarWarning(assignment, today))
      .map(assignment => assignment.id);

    await prisma.assignment.updateMany({
      where: {
        id: { in: reviewedAssignmentIds },
        request: ownedRequest,
        status: { in: ['PENDING', 'ACCEPTED'] },
        calendarReviewed: false,
      },
      data: { calendarReviewed: true },
    });
    return NextResponse.json({ reviewedAssignmentIds });
  } catch {
    return NextResponse.json({ error: 'Die Prüfung konnte nicht gespeichert werden. Bitte erneut versuchen.' }, { status: 503 });
  }
}
