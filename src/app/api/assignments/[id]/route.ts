import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { recalculateRequestStatus } from '@/lib/leaveService';

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        teacher: true,
        request: {
          include: { school: true }
        }
      }
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Security: verify this assignment belongs to a school under the user's Schulamt
    if (assignment.request.school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: Assignment does not belong to your Schulamt.' }, { status: 403 });
    }

    // Löschen und Status-Neuberechnung gemeinsam, damit kein Zwischenstand entsteht.
    //
    // Die frühere Inline-Rechnung hier hatte drei Fehler: Sie zählte auch stornierte
    // Zuweisungen mit, konnte FILLED nie erreichen (eine noch vollständig besetzte
    // Anforderung fiel also auf PARTIALLY_FILLED zurück) und überschrieb sogar den
    // Status UNFILLED - eine Absage, über die die Schule per E-Mail informiert wurde,
    // wäre damit unbemerkt wieder aufgelebt. recalculateRequestStatus behandelt alle
    // drei Fälle korrekt und ist die einzige Stelle, an der der Status berechnet wird.
    const { outboxIds, notificationWarnings } = await prisma.$transaction(async (tx) => {
      await tx.assignment.delete({ where: { id: params.id } });
      await recalculateRequestStatus(tx, assignment.requestId);
      const outboxIds: string[] = [];
      const notificationWarnings: string[] = [];
      if (assignment.teacher.email) {
        const dateStr = new Date(assignment.date).toLocaleDateString('de-DE');
        const queued = await enqueueEmailInTransaction(tx, {
          to: assignment.teacher.email,
          subject: 'Zuweisung aufgehoben / storniert',
          body: `Hallo ${assignment.teacher.name},\n\nIhre Zuweisung für die Schule ${assignment.request.school.name} am ${dateStr} wurde vom Schulamt storniert/aufgehoben.\n\nBitte prüfen Sie Ihr Dashboard für aktuelle Einsätze.`,
          schulamtId: userSession.id,
        });
        if (queued.outboxId) outboxIds.push(queued.outboxId);
        if (queued.warning) notificationWarnings.push(queued.warning);
      }
      return { outboxIds, notificationWarnings };
    });

    const delivery = await deliverOutboxIds(outboxIds);
    if (delivery.delivered < outboxIds.length) {
      notificationWarnings.push('Die Stornierung wurde gespeichert; mindestens eine E-Mail wurde nicht sofort zugestellt. Bitte den E-Mail-Ausgang prüfen.');
    }
    // Notify teacher after the committed cancellation. Outbox failure is
    // reported with the successful response, never as a false 500.
    return NextResponse.json({
      success: true,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error: 'Ein interner Fehler ist aufgetreten.' }, { status: 500 });
  }
}
