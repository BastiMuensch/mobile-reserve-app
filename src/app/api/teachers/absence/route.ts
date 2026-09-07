import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { z } from 'zod';
import { getSchoolYearForDate } from '@/lib/schoolYear';
import { isValidDateKey, parseDateKeyStrict } from '@/lib/dateKey';
import { recalculateRequestStatus } from '@/lib/leaveService';
import { Prisma } from '@prisma/client';

const AbsenceSchema = z.object({
  date: z.string().refine(isValidDateKey, 'Ungültiges Datumsformat (YYYY-MM-DD erforderlich).'),
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

    // Parse date strictly as canonical UTC midnight
    const targetDate = parseDateKeyStrict(date);
    if (!targetDate) {
      return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
    }

    // Nach einer Schuljahresübernahme teilen sich mehrere Teacher-Zeilen denselben
    // Login. Der Ausfall muss an der Zeile des betroffenen Schuljahres hängen.
    const teacher = await prisma.teacher.findFirst({
      where: { userId: userSession.id, schoolYear: getSchoolYearForDate(targetDate) },
      include: { stammschule: { include: { schulamt: true } } }
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Lehrkraft nicht gefunden.' }, { status: 404 });
    }

    const startOfDay = targetDate;
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    // Lesen, Sperren und Stornieren gehören in dieselbe serialisierbare Transaktion
    // wie die Abwesenheit. Sonst könnte eine parallel angelegte Zuweisung zwischen dem
    // früheren Lesen und dem updateMany aktiv bleiben.
    const commitAbsence = () => prisma.$transaction(async (tx) => {
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

      const assignments = await tx.assignment.findMany({
        where: {
          teacherId: teacher.id,
          date: { gte: startOfDay, lte: endOfDay },
          status: { not: 'REJECTED' },
        },
        select: { id: true, requestId: true },
      });

      // 2. Reject all assignments visible in this same transaction.
      if (assignments.length > 0) {
        await tx.assignment.updateMany({
          where: {
            id: { in: assignments.map(a => a.id) }
          },
          data: { status: 'REJECTED' }
        });

        // 3. Recalculate request statuses using central leaveService
        const affectedRequestIds = Array.from(new Set(assignments.map(a => a.requestId)));
        for (const reqId of affectedRequestIds) {
          await recalculateRequestStatus(tx, reqId);
        }
      }
      const schulamtEmail = teacher.stammschule?.schulamt?.email;
      if (!schulamtEmail) return { assignmentCount: assignments.length, outboxIds: [], notificationWarning: undefined };
      const queued = await enqueueEmailInTransaction(tx, {
        to: schulamtEmail,
        subject: `Ungeplanter Ausfall: ${teacher.name}`,
        body: `Die Lehrkraft ${teacher.name} hat einen ungeplanten Ausfall für den ${targetDate.toLocaleDateString('de-DE')} gemeldet.\n\nBegründung:\n${reason}\n\nEs waren ${assignments.length} Einsätze für diesen Tag geplant, welche automatisch wieder in den Status "Ausstehend" versetzt wurden.`,
        schulamtId: teacher.stammschule?.schulamtId || undefined,
      });
      return {
        assignmentCount: assignments.length,
        outboxIds: queued.outboxId ? [queued.outboxId] : [],
        notificationWarning: queued.warning,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });

    let committed: Awaited<ReturnType<typeof commitAbsence>>;
    for (let attempt = 1; ; attempt++) {
      try {
        committed = await commitAbsence();
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 50 * attempt));
          continue;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          return NextResponse.json({ error: 'Die Ausfallmeldung kollidierte mit einer gleichzeitigen Zuweisung. Bitte erneut versuchen.' }, { status: 409 });
        }
        throw error;
      }
    }

    const notificationWarnings: string[] = [];
    if (committed.notificationWarning) notificationWarnings.push(committed.notificationWarning);
    // 4. Send Email to Schulamt after the committed absence/cancellations.
    const delivery = await deliverOutboxIds(committed.outboxIds);
    if (committed.outboxIds.length > 0 && delivery.delivered !== committed.outboxIds.length) notificationWarnings.push('Der Ausfall wurde gespeichert, aber die E-Mail an das Schulamt wurde nicht sofort zugestellt.');

    return NextResponse.json({
      success: true,
      count: committed.assignmentCount,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to report absence' }, { status: 500 });
  }
}
