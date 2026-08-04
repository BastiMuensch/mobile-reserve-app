import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import {
  validateAndCreateAssignments,
  notifyAssignment,
  formatDateKey,
  DoubleBookingError,
  OnLeaveError,
  OutsidePeriodError,
} from '@/lib/assignService';
import { z } from 'zod';

const AssignSchema = z.object({
  requestId: z.string(),
  teacherId: z.string(),
  assignments: z.array(z.object({
    date: z.string(),
    hours: z.number().positive(),
  })).min(1, 'Bitte mindestens eine Zuweisung angeben.'),
});

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = AssignSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    const req = await prisma.request.findUnique({
      where: { id: data.requestId },
      include: { school: { include: { user: true } } }
    });

    if (!req) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (req.school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: Request does not belong to your Schulamt.' }, { status: 403 });
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: data.teacherId },
      include: { user: true, stammschule: true }
    });

    if (!teacher || teacher.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: Teacher does not belong to your Schulamt.' }, { status: 403 });
    }

    // Prüfungen, Anlage und Status-Neuberechnung liegen in src/lib/assignService.ts -
    // dieselbe Logik nutzt die Sammel-Freigabe der Idealbesetzung.
    try {
      await prisma.$transaction(async (tx) => {
        await validateAndCreateAssignments(tx, {
          requestId: data.requestId,
          teacherId: data.teacherId,
          entries: data.assignments,
        });
      });
    } catch (error) {
      if (error instanceof DoubleBookingError) {
        const days = error.conflictDateKeys.map(formatDateKey).join(', ');
        return NextResponse.json({
          error: `Die Lehrkraft ist an folgendem/n Tag(en) bereits verplant: ${days}.`
        }, { status: 409 });
      }
      if (error instanceof OnLeaveError) {
        const days = error.leaveDateKeys.map(formatDateKey).join(', ');
        return NextResponse.json({
          error: `Die Lehrkraft ist an folgendem/n Tag(en) längerfristig abwesend (z.B. Mutterschutz oder Elternzeit): ${days}.`
        }, { status: 409 });
      }
      if (error instanceof OutsidePeriodError) {
        return NextResponse.json({
          error: `Das Datum ${formatDateKey(error.dateKey)} liegt außerhalb des Zeitraums dieser Anforderung.`
        }, { status: 400 });
      }
      throw error;
    }

    // Benachrichtigungen erst nach dem Commit - ein fehlgeschlagener Versand darf die
    // gespeicherte Zuweisung nicht zurückrollen.
    await notifyAssignment({
      teacher,
      request: req,
      entries: data.assignments,
      schulamtId: userSession.id,
    });

    return NextResponse.json({ success: true, count: data.assignments.length }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to assign teacher' }, { status: 500 });
  }
}
