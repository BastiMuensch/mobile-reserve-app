import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { z } from 'zod';

/**
 * Bestätigung eines Einsatzes durch die Lehrkraft.
 *
 * Lehrkräfte können einen zugewiesenen Einsatz ausschließlich BESTÄTIGEN – ein
 * Ablehnen ist bewusst nicht vorgesehen: Über die Einsatzvergabe entscheidet das
 * Schulamt. Kann eine Lehrkraft einen Einsatz tatsächlich nicht wahrnehmen, ist dafür
 * die Ausfallmeldung (/api/teachers/absence) der richtige Weg; nur sie setzt
 * Zuweisungen auf REJECTED und gibt den Bedarf wieder frei.
 */
const StatusSchema = z.object({
  status: z.literal('ACCEPTED', {
    message: 'Ein Einsatz kann nur bestätigt werden. Für eine Absage nutzen Sie bitte die Ausfallmeldung.',
  }),
});

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawData = await request.json();
    const parsed = StatusSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        teacher: true,
        request: {
          include: {
            school: {
              include: {
                schulamt: true
              }
            }
          }
        }
      }
    });

    if (!assignment || assignment.teacher.userId !== userSession.id) {
      return NextResponse.json({ error: 'Not your assignment' }, { status: 403 });
    }

    // Atomar aktualisieren: Eine gleichzeitig auf REJECTED gesetzte Zuweisung darf
    // nicht wieder ACCEPTED werden. Bei 0 Zeilen HTTP 409 liefern.
    const { updateResult, updatedAssignment, outboxIds, notificationWarnings } = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.assignment.updateMany({
        where: { id: params.id, status: 'PENDING', teacher: { userId: userSession.id } },
        data: { status: 'ACCEPTED' },
      });
      const updatedAssignment = await tx.assignment.findFirst({
        where: { id: params.id, teacher: { userId: userSession.id } },
      });
      const outboxIds: string[] = [];
      const notificationWarnings: string[] = [];
      const schulamtEmail = assignment.request.school.schulamt?.email;
      if (updateResult.count === 1 && schulamtEmail) {
        const dateStr = new Date(assignment.date).toLocaleDateString('de-DE');
        const queued = await enqueueEmailInTransaction(tx, {
          to: schulamtEmail,
          subject: `Einsatz bestätigt: ${assignment.teacher.name}`,
          body: `Die Lehrkraft ${assignment.teacher.name} hat den Einsatz an der Schule ${assignment.request.school.name} am ${dateStr} bestätigt.`,
          schulamtId: assignment.request.school.schulamt?.id,
        });
        if (queued.outboxId) outboxIds.push(queued.outboxId);
        if (queued.warning) notificationWarnings.push(queued.warning);
      }
      return { updateResult, updatedAssignment, outboxIds, notificationWarnings };
    });

    if (updateResult.count === 0) {
      if (updatedAssignment?.status === 'ACCEPTED') {
        return NextResponse.json({ ...updatedAssignment, alreadyAccepted: true });
      }
      return NextResponse.json(
        { error: 'Dieser Einsatz wurde bereits storniert oder geändert und kann nicht mehr bestätigt werden.' },
        { status: 409 }
      );
    }

    const delivery = await deliverOutboxIds(outboxIds);
    if (delivery.delivered < outboxIds.length) {
      notificationWarnings.push('Die Bestätigung wurde gespeichert; mindestens eine E-Mail wurde nicht sofort zugestellt. Bitte den E-Mail-Ausgang prüfen.');
    }

    return NextResponse.json({
      ...updatedAssignment!,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error: 'Ein interner Fehler ist aufgetreten.' }, { status: 500 });
  }
}
