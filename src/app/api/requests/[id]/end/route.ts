import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { isValidDateKey, parseDateKeyStrict, toCanonicalUtcDate } from '@/lib/dateKey';
import { cancelAssignmentsAfter, recalculateRequestStatus } from '@/lib/leaveService';
import {
  enqueueCancellationEmailInTransaction,
  notifyAssignmentsCancelled,
  runIndependentNotificationTasks,
} from '@/lib/assignService';
import { z } from 'zod';

/**
 * "Rückkehr melden": Ein Bedarf, den die Schule ohne bekanntes Ende gemeldet hat
 * ("bis auf Weiteres"), bekommt sein Enddatum. Danach ist er ein ganz normaler Bedarf
 * mit Zeitraum und verschwindet nach dessen Ablauf aus den offenen Listen.
 *
 * Sowohl die Schule als auch ihr Schulamt dürfen das melden - im Alltag ruft die Schule
 * auch mal an, statt es selbst einzutragen.
 */
const EndSchema = z.object({
  lastDay: z.string().refine(isValidDateKey, 'Ungültiges Datumsformat (YYYY-MM-DD erforderlich).'),
});

/** Bis zu wie viele Tage in der Zukunft ein Enddatum plausibel ist (Tippschutz). */
const MAX_FUTURE_DAYS = 30;

class RequestEndChangedError extends Error {
  constructor() {
    super('Request is no longer open-ended');
    this.name = 'RequestEndChangedError';
  }
}

async function loadOwnedRequest(id: string, userSession: { id: string; role: string; schoolId?: string | null }) {
  const req = await prisma.request.findUnique({
    where: { id },
    include: { school: { include: { user: true, schulamt: true } } },
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

    const parsed = EndSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const loaded = await loadOwnedRequest(id, {
      id: userSession.id,
      role: userSession.role,
      schoolId: userSession.school?.id ?? null,
    });
    if ('error' in loaded) return loaded.error;
    const req = loaded.req;

    if (!req.isOpenEnded || req.endDate) {
      return NextResponse.json({
        error: 'Nur ein Bedarf ohne festes Ende ("bis auf Weiteres") kann beendet werden.',
      }, { status: 409 });
    }

    const parsedDay = parseDateKeyStrict(parsed.data.lastDay);
    if (!parsedDay) {
      return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
    }

    const lastDay = parsedDay;
    const requestStart = toCanonicalUtcDate(req.date);
    if (lastDay < requestStart) {
      return NextResponse.json({
        error: `Der letzte Einsatztag darf nicht vor dem Beginn der Anforderung (${requestStart.toLocaleDateString('de-DE')}) liegen.`,
      }, { status: 400 });
    }

    const maxDay = toCanonicalUtcDate(new Date());
    maxDay.setUTCDate(maxDay.getUTCDate() + MAX_FUTURE_DAYS);
    if (lastDay > maxDay) {
      return NextResponse.json({
        error: `Der letzte Einsatztag darf höchstens ${MAX_FUTURE_DAYS} Tage in der Zukunft liegen.`,
      }, { status: 400 });
    }

    const committed = await prisma.$transaction(async (tx) => {
      // Erst das Ende setzen, dann stornieren: recalculateRequestStatus rechnet danach
      // gegen den nun bekannten Zeitraum statt gegen den offenen.
      const claimed = await tx.request.updateMany({
        where: { id, isOpenEnded: true, endDate: null },
        data: { endDate: lastDay, endedAt: new Date(), isOpenEnded: false },
      });
      if (claimed.count !== 1) throw new RequestEndChangedError();

      const affected = await cancelAssignmentsAfter(tx, id, lastDay);
      await recalculateRequestStatus(tx, id);

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
      const cancellationReason = `Die vertretene Lehrkraft ist ab dem ${new Date(lastDay.getTime() + 86400000).toLocaleDateString('de-DE')} zurück.`;
      const cancellationNotifications = await Promise.all(Array.from(byTeacher.values(), ({ teacher, entries }) =>
        enqueueCancellationEmailInTransaction(tx, {
          teacher,
          schoolName: req.school.name,
          entries,
          schulamtId,
          reason: cancellationReason,
        }),
      ));

      const schulamtEmail = req.school.schulamt?.email;
      const notification = schulamtEmail
        ? await enqueueEmailInTransaction(tx, {
          to: schulamtEmail,
          subject: `Vertretung beendet: ${req.school.name}`,
          body: `Die Schule ${req.school.name} hat die Rückkehr gemeldet.\n\n` +
            `Zu vertreten war: ${req.substitutedTeacher}\n` +
            `Letzter Einsatztag: ${lastDay.toLocaleDateString('de-DE')}\n\n` +
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
          ...(notification?.outboxId ? [notification.outboxId] : []),
          ...cancellationNotifications.flatMap(result => result.outboxIds),
        ],
        notificationWarnings: [
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
          schoolName: req.school.name,
          entries,
          schulamtId: committed.schulamtId,
          reason: committed.cancellationReason,
        });
        return result.warnings.length > 0 ? result.warnings.join(' ') : null;
      }),
    );
    notificationWarnings.push(...cancellationWarnings);

    return NextResponse.json({
      request: committed.updated,
      cancelledAssignments: cancelled.length,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    });
  } catch (error) {
    if (error instanceof RequestEndChangedError || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) {
      return NextResponse.json({
        error: 'Die Anforderung wurde inzwischen bereits beendet. Bitte laden Sie die Seite neu.',
      }, { status: 409 });
    }
    console.error('Beenden der Vertretung fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Die Vertretung konnte nicht beendet werden.' }, { status: 500 });
  }
}
