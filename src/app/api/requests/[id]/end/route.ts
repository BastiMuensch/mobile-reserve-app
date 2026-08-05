import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { toLocalDayStart } from '@/lib/matching';
import { cancelAssignmentsAfter, recalculateRequestStatus } from '@/lib/leaveService';
import { notifyAssignmentsCancelled } from '@/lib/assignService';
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
  lastDay: z.string().min(1, 'Bitte den letzten Einsatztag angeben.'),
});

/** Bis zu wie viele Tage in der Zukunft ein Enddatum plausibel ist (Tippschutz). */
const MAX_FUTURE_DAYS = 30;

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

    const parsedDay = new Date(parsed.data.lastDay);
    if (Number.isNaN(parsedDay.getTime())) {
      return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
    }

    const lastDay = toLocalDayStart(parsedDay);
    const requestStart = toLocalDayStart(req.date);
    if (lastDay < requestStart) {
      return NextResponse.json({
        error: `Der letzte Einsatztag darf nicht vor dem Beginn der Anforderung (${requestStart.toLocaleDateString('de-DE')}) liegen.`,
      }, { status: 400 });
    }

    const maxDay = toLocalDayStart(new Date());
    maxDay.setDate(maxDay.getDate() + MAX_FUTURE_DAYS);
    if (lastDay > maxDay) {
      return NextResponse.json({
        error: `Der letzte Einsatztag darf höchstens ${MAX_FUTURE_DAYS} Tage in der Zukunft liegen.`,
      }, { status: 400 });
    }

    const cancelled = await prisma.$transaction(async (tx) => {
      // Erst das Ende setzen, dann stornieren: recalculateRequestStatus rechnet danach
      // gegen den nun bekannten Zeitraum statt gegen den offenen.
      await tx.request.update({
        where: { id },
        data: { endDate: lastDay, endedAt: new Date(), isOpenEnded: false },
      });

      const affected = await cancelAssignmentsAfter(tx, id, lastDay);
      await recalculateRequestStatus(tx, id);
      return affected;
    });

    // Benachrichtigungen nach dem Commit; Fehler nur loggen, damit ein hängender
    // Mailserver die bereits gespeicherte Rückmeldung nicht zunichte macht.
    const schulamtId = req.school.schulamtId ?? userSession.id;

    // Je Lehrkraft eine Nachricht mit allen entfallenen Tagen, nicht eine pro Tag.
    const byTeacher = new Map<string, { teacher: (typeof cancelled)[number]['teacher']; entries: { date: Date; hours: number }[] }>();
    for (const a of cancelled) {
      const bucket = byTeacher.get(a.teacherId);
      if (bucket) bucket.entries.push({ date: a.date, hours: a.hours });
      else byTeacher.set(a.teacherId, { teacher: a.teacher, entries: [{ date: a.date, hours: a.hours }] });
    }

    for (const { teacher, entries } of byTeacher.values()) {
      await notifyAssignmentsCancelled({
        teacher,
        schoolName: req.school.name,
        entries,
        schulamtId,
        reason: `Die vertretene Lehrkraft ist ab dem ${new Date(lastDay.getTime() + 86400000).toLocaleDateString('de-DE')} zurück.`,
      });
    }

    try {
      const schulamtEmail = req.school.schulamt?.email;
      if (schulamtEmail) {
        await sendEmail(
          schulamtEmail,
          `Vertretung beendet: ${req.school.name}`,
          `Die Schule ${req.school.name} hat die Rückkehr gemeldet.\n\n` +
          `Zu vertreten war: ${req.substitutedTeacher}\n` +
          `Letzter Einsatztag: ${lastDay.toLocaleDateString('de-DE')}\n\n` +
          (cancelled.length > 0
            ? `${cancelled.length} bereits geplante Einsätze nach diesem Tag wurden storniert; die betroffenen Lehrkräfte wurden benachrichtigt.`
            : 'Es waren keine Einsätze nach diesem Tag geplant.'),
          schulamtId
        );
      }
    } catch (error) {
      console.error('Benachrichtigung des Schulamts zur beendeten Vertretung fehlgeschlagen:', error);
    }

    const updated = await prisma.request.findUniqueOrThrow({ where: { id } });
    return NextResponse.json({ request: updated, cancelledAssignments: cancelled.length });
  } catch (error) {
    console.error('Beenden der Vertretung fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Die Vertretung konnte nicht beendet werden.' }, { status: 500 });
  }
}
