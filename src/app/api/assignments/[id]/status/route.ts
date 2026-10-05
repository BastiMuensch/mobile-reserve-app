import { deploymentSchoolName } from "@/lib/schoolLocations";
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { z } from 'zod';
import { enqueueHomeSchoolNotifications } from '@/lib/homeSchoolNotifications';
import { formatConfirmationDate } from '@/lib/assignmentConfirmation';

/** Teachers acknowledge assignments; cancellations use the absence workflow. */
const StatusSchema = z.object({
  status: z.literal('ACCEPTED', {
    message: 'Ein Einsatz kann nur bestätigt werden. Für eine Absage nutzen Sie bitte die Ausfallmeldung.',
  }),
  // Explicit IDs freeze the days displayed to the teacher. Days assigned later
  // must never be silently included in an earlier confirmation.
  assignmentIds: z.array(z.string().min(1)).min(1).max(1000).optional(),
});

class ConfirmationError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const changedMessage = 'Mindestens ein Einsatz wurde storniert oder geändert. Bitte aktualisieren Sie die Übersicht und bestätigen Sie die verbleibenden Einsätze erneut.';

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = StatusSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const ids = [...new Set(parsed.data.assignmentIds ?? [params.id])];
    if (!ids.includes(params.id)) {
      return NextResponse.json({ error: 'Die Auswahl muss den angezeigten Einsatz enthalten.' }, { status: 400 });
    }

    const confirm = () => prisma.$transaction(async tx => {
      const assignment = await tx.assignment.findUnique({
        where: { id: params.id },
        include: {
          teacher: { include: { stammschule: { select: { schulamtId: true } } } },
          request: { include: { location: true, school: { include: { schulamt: true } } } },
        },
      });
      if (!assignment || assignment.teacher.userId !== userSession.id ||
        assignment.teacher.stammschule.schulamtId !== assignment.request.school.schulamtId) {
        throw new ConfirmationError('Not your assignment', 403);
      }
      const assignments = await tx.assignment.findMany({
        where: {
          id: { in: ids },
          teacherId: assignment.teacherId,
          requestId: assignment.requestId,
          teacher: { userId: userSession.id },
        },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      });
      if (assignments.length !== ids.length || assignment.request.status === 'CANCELLED' ||
        assignments.some(item => item.status !== 'PENDING' && item.status !== 'ACCEPTED')) {
        throw new ConfirmationError(changedMessage, 409);
      }
      const pending = assignments.filter(item => item.status === 'PENDING');
      const pendingIds = pending.map(item => item.id);
      const outboxIds: string[] = [];
      const notificationWarnings: string[] = [];
      if (pendingIds.length > 0) {
        const update = await tx.assignment.updateMany({
          where: {
            id: { in: pendingIds }, status: 'PENDING',
            requestId: assignment.requestId, teacherId: assignment.teacherId,
            teacher: { userId: userSession.id },
          },
          data: { status: 'ACCEPTED' },
        });
        // A concurrent cancellation must roll back the entire group, not leave
        // an acknowledgement of only some of the displayed days.
        if (update.count !== pendingIds.length) throw new ConfirmationError(changedMessage, 409);

        const schulamtEmail = assignment.request.school.schulamt?.email;
        if (schulamtEmail) {
          const dates = pending.map(item => formatConfirmationDate(item.date));
          const period = dates.length === 1 ? `am ${dates[0]}` : `an ${dates.length} Einsatztagen vom ${dates[0]} bis ${dates[dates.length - 1]}`;
          const queued = await enqueueEmailInTransaction(tx, {
            to: schulamtEmail,
            subject: `${dates.length > 1 ? 'Einsatzserie' : 'Einsatz'} bestätigt: ${assignment.teacher.name}`,
            body: `Die Lehrkraft ${assignment.teacher.name} hat den Einsatz an der Schule ${deploymentSchoolName(assignment.request)} ${period} bestätigt.${dates.length > 1 ? `\n\nBestätigte Tage: ${dates.join(', ')}` : ''}`,
            schulamtId: assignment.request.school.schulamtId ?? undefined,
          });
          if (queued.outboxId) outboxIds.push(queued.outboxId);
          if (queued.warning) notificationWarnings.push(queued.warning);
        }
        const home = await enqueueHomeSchoolNotifications(tx, {
          where: { id: { in: pendingIds } }, event: 'ACCEPTED', schulamtId: assignment.request.school.schulamtId,
        });
        outboxIds.push(...home.outboxIds);
        notificationWarnings.push(...home.warnings);
      }
      return {
        updatedAssignment: { ...assignments.find(item => item.id === params.id)!, status: 'ACCEPTED' },
        confirmedCount: pendingIds.length,
        confirmedAssignmentIds: ids,
        outboxIds,
        notificationWarnings,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Concurrent confirmations may conflict, then retry against fresh state.
    // The second attempt is idempotent and queues no duplicate notifications.
    let result: Awaited<ReturnType<typeof confirm>> | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await confirm();
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          if (attempt < 2) continue;
          throw new ConfirmationError(changedMessage, 409);
        }
        throw error;
      }
    }
    const { updatedAssignment, confirmedCount, confirmedAssignmentIds, outboxIds, notificationWarnings } = result!;
    const delivery = await deliverOutboxIds(outboxIds);
    if (delivery.delivered < outboxIds.length) {
      notificationWarnings.push('Die Bestätigung wurde gespeichert; mindestens eine E-Mail wurde nicht sofort zugestellt. Bitte den E-Mail-Ausgang prüfen.');
    }

    return NextResponse.json({
      ...updatedAssignment,
      confirmedCount,
      confirmedAssignmentIds,
      alreadyAccepted: confirmedCount === 0,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    });
  } catch (error: unknown) {
    if (error instanceof ConfirmationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Ungültige Bestätigung.' }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Ein interner Fehler ist aufgetreten.' }, { status: 500 });
  }
}
