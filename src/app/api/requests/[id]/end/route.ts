import { deploymentSchoolName } from "@/lib/schoolLocations";
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { requestLifecyclePlan, requestLifecycleSchema } from '@/lib/requestLifecycle';
import { cancelAssignmentsAfter, recalculateRequestStatus } from '@/lib/leaveService';
import {
  enqueueCancellationEmailInTransaction,
  notifyAssignmentsCancelled,
  runIndependentNotificationTasks,
} from '@/lib/assignService';
import { unperformedAssignmentWhere } from '@/lib/assignmentHours';
import { enqueueHomeSchoolNotifications } from '@/lib/homeSchoolNotifications';

/** Schools and their office can shorten or cancel any demand; past work remains recorded. */
class RequestEndChangedError extends Error {
  constructor() {
    super('Request is no longer open-ended');
    this.name = 'RequestEndChangedError';
  }
}

async function loadOwnedRequest(id: string, userSession: { id: string; role: string; schoolId?: string | null }) {
  const req = await prisma.request.findUnique({
    where: { id },
    include: { location: { select: { name: true } }, school: { select: { name: true, schulamtId: true, schulamt: { select: { email: true } } } } },
  });

  if (!req) {
    return { error: NextResponse.json({ error: 'Anforderung nicht gefunden.' }, { status: 404 }) };
  }

  if (userSession.role === 'SCHOOL') {
    if (req.schoolId !== userSession.schoolId) {
      return { error: NextResponse.json({ error: 'Forbidden: Diese Anforderung gehört nicht zu Ihrer Schule.' }, { status: 403 }) };
    }
    return { req };
  }

  if (userSession.role === 'SCHULAMT') {
    if (req.school.schulamtId !== userSession.id) {
      return { error: NextResponse.json({ error: 'Forbidden: Anforderung gehört nicht zu Ihrem Schulamt.' }, { status: 403 }) };
    }
    return { req };
  }

  return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userSession = await getSessionUser();
  if (!userSession || (userSession.role !== 'SCHOOL' && userSession.role !== 'SCHULAMT')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    const parsed = requestLifecycleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const loaded = await loadOwnedRequest(id, {
      id: userSession.id,
      role: userSession.role,
      schoolId: userSession.school?.id ?? null,
    });
    if ('error' in loaded) return loaded.error!;
    const req = loaded.req;

    if (req.status === 'CANCELLED' || req.status === 'ENDED') return NextResponse.json({ request: { id: req.id, status: req.status, endDate: req.endDate, isOpenEnded: req.isOpenEnded, endedAt: req.endedAt }, cancelledAssignments: 0 });
    let plan;
    try { plan = requestLifecyclePlan(req, parsed.data); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Ungültiger Zeitraum.' }, { status: 400 }); }
    const { lastDay, cancelAfter, action } = plan;

    const committed = await prisma.$transaction(async (tx) => {
      const performed = await tx.assignment.findFirst({
        where: { requestId: id, status: { in: ['PENDING', 'ACCEPTED'] }, OR: [{ actualHours: { gt: 0 } }, { actualAdditionalMinutes: { gt: 0 } }, { hourCorrections: { some: { status: 'PENDING', OR: [{ proposedHours: { gt: 0 } }, { additionalMinutes: { gt: 0 } }] } } }] },
        orderBy: { date: 'desc' }, select: { date: true },
      });
      const entirelyCancelled = plan.entirelyCancelled && !performed;
      // Work performed after a reported return belongs to the assignment history,
      // not to the remaining demand. Extending the demand would reopen vacancies.
      const recordedEnd = action === 'CANCEL' && lastDay < req.date ? req.date : lastDay;
      // Erst das Ende setzen, dann stornieren: recalculateRequestStatus rechnet danach
      // gegen den nun bekannten Zeitraum statt gegen den offenen.
      const claimed = await tx.request.updateMany({
        where: { id, updatedAt: req.updatedAt, status: { not: 'CANCELLED' } },
        data: { ...(entirelyCancelled ? { status: 'CANCELLED' } : { endDate: recordedEnd, ...(action === 'CANCEL' ? { status: 'ENDED' } : {}) }), endedAt: new Date(), isOpenEnded: false },
      });
      if (claimed.count !== 1) throw new RequestEndChangedError();

      const home = await enqueueHomeSchoolNotifications(tx, {
        where: { ...unperformedAssignmentWhere(), requestId: id, status: { in: ['PENDING', 'ACCEPTED'] }, date: { gt: new Date(cancelAfter.getTime() + 86399999) } }, event: action === 'END' ? 'ENDED' : 'CANCELLED',
        schulamtId: req.school.schulamtId, lastDay,
      });
      const affected = await cancelAssignmentsAfter(tx, id, cancelAfter);
      await recalculateRequestStatus(tx, id);
      await tx.requestLifecycleEvent.create({ data: {
        requestId: id, action, actorId: userSession.id, lastDay: entirelyCancelled ? null : lastDay,
        previousEndDate: req.endDate, wasOpenEnded: req.isOpenEnded, cancelledAssignments: affected.length,
      } });

      // Je Lehrkraft eine Nachricht mit allen entfallenen Tagen, nicht eine pro Tag.
      const byTeacher = new Map<string, { teacher: (typeof affected)[number]['teacher']; entries: { date: Date; hours: number }[] }>();
      for (const assignment of affected) {
        const bucket = byTeacher.get(assignment.teacherId);
        if (bucket) bucket.entries.push({ date: assignment.date, hours: assignment.hours });
        else byTeacher.set(assignment.teacherId, {
          teacher: assignment.teacher,
          entries: [{ date: assignment.date, hours: assignment.hours }],
        });
      }
      const schulamtId = req.school.schulamtId ?? userSession.id;
      const cancellationReason = action === 'CANCEL' ? 'Die Schule hat den verbleibenden Bedarf storniert.' : `Die vertretene Lehrkraft ist ab dem ${new Date(lastDay.getTime() + 86400000).toLocaleDateString('de-DE', { timeZone: 'UTC' })} zurück.`;
      const cancellationNotifications = await Promise.all(Array.from(byTeacher.values(), ({ teacher, entries }) =>
        enqueueCancellationEmailInTransaction(tx, {
          teacher,
          schoolName: deploymentSchoolName(req),
          entries,
          schulamtId,
          reason: cancellationReason,
        }),
      ));

      const schulamtEmail = req.school.schulamt?.email;
      const notification = schulamtEmail
        ? await enqueueEmailInTransaction(tx, {
          to: schulamtEmail,
          subject: `Vertretung beendet: ${deploymentSchoolName(req)}`,
          body: `Für ${deploymentSchoolName(req)} wurde ${action === 'CANCEL' ? plan.keptToday ? 'der Bedarf ab morgen storniert; der heutige Einsatz bleibt bestehen' : 'der verbleibende Bedarf storniert' : 'die Rückkehr gemeldet'}.\n\n` +
            `Zu vertreten war: ${req.substitutedTeacher}\n` +
            (entirelyCancelled ? 'Der Bedarf entfällt vollständig.\n\n' : `Letzter benötigter Einsatztag: ${lastDay.toLocaleDateString('de-DE', { timeZone: 'UTC' })}\nBereits vergangene Einsätze bleiben dokumentiert.\n\n`) +
            (affected.length > 0
              ? `${affected.length} bereits geplante Einsätze nach diesem Tag wurden storniert; Benachrichtigungen an betroffene Lehrkräfte wurden zur Zustellung vorgemerkt.`
              : 'Es waren keine Einsätze nach diesem Tag geplant.'),
          schulamtId,
        })
        : null;
      const updated = await tx.request.findUniqueOrThrow({ where: { id } });
      return {
        affected,
        updated,
        notification,
        teacherNotifications: Array.from(byTeacher.values()),
        outboxIds: [
          ...home.outboxIds,
          ...(notification?.outboxId ? [notification.outboxId] : []),
          ...cancellationNotifications.flatMap(result => result.outboxIds),
        ],
        notificationWarnings: [
          ...home.warnings,
          ...(notification?.warning ? [notification.warning] : []),
          ...cancellationNotifications.flatMap(result => result.warnings),
        ],
        schulamtId,
        cancellationReason,
      };
    }, { isolationLevel: 'Serializable' });
    const cancelled = committed.affected;

    // Nach Commit folgen ausschließlich die Outbox-Zustellung und Push-Nachrichten.
    const notificationWarnings: string[] = [...committed.notificationWarnings];
    const delivery = await deliverOutboxIds(committed.outboxIds);
    if (committed.outboxIds.length > 0 && delivery.delivered !== committed.outboxIds.length) {
      notificationWarnings.push('Mindestens eine E-Mail wurde nicht sofort zugestellt.');
    }
    const cancellationWarnings = await runIndependentNotificationTasks(
      committed.teacherNotifications.map(({ teacher, entries }) => async () => {
        const result = await notifyAssignmentsCancelled({
          teacher,
          schoolName: deploymentSchoolName(req),
          entries,
          schulamtId: committed.schulamtId,
          reason: committed.cancellationReason,
        });
        return result.warnings.length > 0 ? result.warnings.join(' ') : null;
      }),
    );
    notificationWarnings.push(...cancellationWarnings);

    return NextResponse.json({
      request: { id: committed.updated.id, status: committed.updated.status, endDate: committed.updated.endDate, isOpenEnded: committed.updated.isOpenEnded, endedAt: committed.updated.endedAt },
      cancelledAssignments: cancelled.length,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    });
  } catch (error) {
    if (error instanceof RequestEndChangedError || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) {
      return NextResponse.json({
        error: 'Die Anforderung wurde inzwischen geändert. Bitte laden Sie die Seite neu und prüfen Sie den aktuellen Stand.',
      }, { status: 409 });
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ungültige Eingabe.' }, { status: 400 });
    console.error('Beenden der Vertretung fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Die Vertretung konnte nicht beendet werden.' }, { status: 500 });
  }
}
