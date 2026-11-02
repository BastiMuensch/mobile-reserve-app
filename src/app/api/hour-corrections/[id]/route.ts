import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { canCorrectAssignmentHours, hourReviewSchema } from '@/lib/assignmentHours';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { releaseUnperformedAssignmentAfterReview } from '@/lib/assignmentWorkProtection';
import { enqueueCancellationEmailInTransaction, notifyAssignmentsCancelled } from '@/lib/assignService';
import { enqueueHomeSchoolNotifications } from '@/lib/homeSchoolNotifications';
import { deploymentSchoolName } from '@/lib/schoolLocations';

class ReviewConflict extends Error {}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Nur das Schulamt darf Stundenkorrekturen prüfen.' }, { status: 403 });
  try {
    const parsed = hourReviewSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { id } = await params;
    const result = await prisma.$transaction(async tx => {
      const correction = await tx.assignmentHourCorrection.findFirst({ where: {
        id, assignment: { request: { school: { schulamtId: user.id } } },
      }, include: { assignment: { include: { teacher: { select: { name: true, email: true, userId: true, user: { select: { email: true } } } }, request: { include: { location: { select: { name: true } }, school: { include: { user: true } } } } } } } });
      if (!correction) return null;
      if (correction.status !== 'PENDING') throw new ReviewConflict('Diese Korrektur wurde bereits geprüft.');
      const assignment = correction.assignment;
      if (parsed.data.decision === 'APPROVED') {
        if (assignment.request.status === 'CANCELLED' || !canCorrectAssignmentHours(assignment)) throw new ReviewConflict('Der Einsatz ist nicht mehr bestätigt. Bitte die Korrektur ablehnen oder den Einsatz zuerst prüfen.');
        const updated = await tx.assignment.updateMany({
          where: { id: assignment.id, status: 'ACCEPTED', hours: correction.plannedHours, actualHours: correction.previousActualHours, actualAdditionalMinutes: correction.previousAdditionalMinutes },
          data: { actualHours: correction.proposedHours, actualAdditionalMinutes: correction.additionalMinutes },
        });
        if (updated.count !== 1) throw new ReviewConflict('Die Stunden wurden inzwischen geändert. Bitte den aktuellen Stand prüfen.');
      }
      const claimed = await tx.assignmentHourCorrection.updateMany({ where: { id, status: 'PENDING' }, data: {
        status: parsed.data.decision, reviewedById: user.id, reviewedAt: new Date(), reviewNote: parsed.data.reviewNote || null,
      } });
      if (claimed.count !== 1) throw new ReviewConflict('Diese Korrektur wurde inzwischen geprüft.');
      const released = await releaseUnperformedAssignmentAfterReview(tx, assignment.id);
      const cancellation = released ? {
        teacher: assignment.teacher, schoolName: deploymentSchoolName(assignment.request),
        entries: [{ date: assignment.date, hours: assignment.hours }], schulamtId: user.id,
        reason: 'Die bereits gemeldete Stornierung oder Abwesenheit gilt nach Abschluss der Stundenprüfung auch für diesen Einsatz.',
      } : null;
      const teacherNotification = cancellation ? await enqueueCancellationEmailInTransaction(tx, cancellation) : null;
      const home = released ? await enqueueHomeSchoolNotifications(tx, {
        where: { id: assignment.id }, event: 'CANCELLED', schulamtId: user.id,
      }) : null;
      const recipient = assignment.request.school.user;
      const queued = recipient?.isActive ? await enqueueEmailInTransaction(tx, {
        schulamtId: user.id, to: recipient.email, subject: `Stundenkorrektur ${parsed.data.decision === 'APPROVED' ? 'bestätigt' : 'abgelehnt'}`,
        body: `Das Schulamt hat die Stundenkorrektur für ${assignment.teacher.name} am ${assignment.date.toLocaleDateString('de-DE', { timeZone: 'UTC' })} ${parsed.data.decision === 'APPROVED' ? 'bestätigt' : 'abgelehnt'}.\nDen geprüften Stand und die Rückmeldung finden Sie im Portal beim Bedarf.`,
      }) : null;
      return { cancellation, outboxIds: [...(queued?.outboxId ? [queued.outboxId] : []), ...(teacherNotification?.outboxIds ?? []), ...(home?.outboxIds ?? [])] };
    }, { isolationLevel: 'Serializable' });
    if (!result) return NextResponse.json({ error: 'Korrektur nicht gefunden.' }, { status: 404 });
    if (result.outboxIds.length) await deliverOutboxIds(result.outboxIds).catch(() => undefined);
    if (result.cancellation) await notifyAssignmentsCancelled(result.cancellation).catch(() => undefined);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ReviewConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return NextResponse.json({ error: 'Der Einsatz wurde gleichzeitig geändert. Bitte neu laden.' }, { status: 409 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ungültige Eingabe.' }, { status: 400 });
    console.error('Stundenprüfung fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Die Prüfung konnte nicht gespeichert werden.' }, { status: 500 });
  }
}
