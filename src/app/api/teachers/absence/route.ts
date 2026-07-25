import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { z } from 'zod';

const AbsenceSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  reason: z.string().min(5, 'Bitte geben Sie eine Begründung an.'),
});

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawData = await request.json();
    const parsed = AbsenceSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { date, reason } = parsed.data;

    // Verify teacher exists
    const teacher = await prisma.teacher.findFirst({
      where: { userId: userSession.id },
      include: { stammschule: { include: { schulamt: true } } }
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Lehrkraft nicht gefunden.' }, { status: 404 });
    }

    // Normalize to local day start - consistent with how matching.ts reads Absence.date
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const startOfDay = new Date(targetDate);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Find assignments for this teacher on this day
    const assignments = await prisma.assignment.findMany({
      where: {
        teacherId: teacher.id,
        date: {
          gte: startOfDay,
          lte: endOfDay
        },
        status: { not: 'REJECTED' }
      },
      include: {
        request: true
      }
    });

    // We do all updates in a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Record the absence itself. This is the source of truth the matching engine reads
      // (see rankCandidates in src/lib/matching.ts) - it does NOT flip the teacher's global
      // status, since that would either deactivate them permanently (no automatic reset) or
      // require extra bookkeeping we can't currently guarantee to unwind correctly. Re-reporting
      // the same day updates the existing record instead of creating a duplicate.
      const existingAbsence = await tx.absence.findFirst({
        where: { teacherId: teacher.id, date: startOfDay, type: 'UNAVAILABLE' }
      });

      if (existingAbsence) {
        await tx.absence.update({
          where: { id: existingAbsence.id },
          data: { reason }
        });
      } else {
        await tx.absence.create({
          data: {
            teacherId: teacher.id,
            date: startOfDay,
            type: 'UNAVAILABLE',
            reason
          }
        });
      }

      // 2. Reject all assignments for that day
      if (assignments.length > 0) {
        await tx.assignment.updateMany({
          where: {
            id: { in: assignments.map(a => a.id) }
          },
          data: { status: 'REJECTED' }
        });

        // 3. Recalculate request statuses
        for (const a of assignments) {
          const reqAssignments = await tx.assignment.findMany({
            where: { requestId: a.requestId, status: { not: 'REJECTED' }, id: { not: a.id } }
          });
          const filledHours = reqAssignments.reduce((sum, item) => sum + item.hours, 0);

          let newStatus = 'PARTIALLY_FILLED';
          if (filledHours === 0) newStatus = 'PENDING';
          else if (filledHours >= a.request.weeklyHours) newStatus = 'FILLED';

          await tx.request.update({
            where: { id: a.requestId },
            data: { status: newStatus }
          });
        }
      }
    });

    // 4. Send Email to Schulamt
    const schulamtEmail = teacher.stammschule?.schulamt?.email;
    if (schulamtEmail) {
      const emailBody = `Die Lehrkraft ${teacher.name} hat einen ungeplanten Ausfall für den ${targetDate.toLocaleDateString('de-DE')} gemeldet.\n\n` +
        `Begründung:\n${reason}\n\n` +
        `Es waren ${assignments.length} Einsätze für diesen Tag geplant, welche automatisch wieder in den Status "Ausstehend" versetzt wurden.`;
        
      await sendEmail(schulamtEmail, `Ungeplanter Ausfall: ${teacher.name}`, emailBody, teacher.stammschule.schulamtId || undefined);
    }

    return NextResponse.json({ success: true, count: assignments.length });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to report absence' }, { status: 500 });
  }
}
