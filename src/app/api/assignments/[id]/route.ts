import { deploymentSchoolName } from "@/lib/schoolLocations";
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { unperformedAssignmentWhere } from '@/lib/assignmentHours';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { recalculateRequestStatus } from '@/lib/leaveService';
import { resolveTeacherNotificationRecipient } from '@/lib/assignService';
import { enqueueHomeSchoolNotifications } from '@/lib/homeSchoolNotifications';
import { emailDate, requestEmailDetails } from '@/lib/requestEmail';

class CancellationError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { outboxIds, notificationWarnings } = await prisma.$transaction(async (tx) => {
      const assignment = await tx.assignment.findUnique({
        where: { id: params.id },
        include: {
          teacher: { include: { user: true } },
          request: { include: { location: true, school: true } },
          _count: { select: { hourCorrections: true } },
        },
      });
      if (!assignment) throw new CancellationError('Assignment not found', 404);
      if (assignment.request.school.schulamtId !== userSession.id) {
        throw new CancellationError('Forbidden: Assignment does not belong to your Schulamt.', 403);
      }
      const unperformed = await tx.assignment.findFirst({
        where: { id: params.id, ...unperformedAssignmentWhere() }, select: { id: true },
      });
      if (!unperformed) {
        throw new CancellationError('Für diesen Einsatz sind geleistete Stunden oder zusätzliche Aufgaben bestätigt oder zur Prüfung gemeldet. Bitte zuerst die Stundenmeldung prüfen und gegebenenfalls korrigieren. Der Einsatznachweis bleibt erhalten.', 409);
      }
      // Claim the active transition before notifying. An absence/leave cancellation
      // that won the row lock must not generate a second cancellation notice here.
      const cancelled = await tx.assignment.updateMany({
        where: { id: params.id, status: { in: ['PENDING', 'ACCEPTED'] }, ...unperformedAssignmentWhere() }, data: { status: 'REJECTED' },
      });
      const home = cancelled.count === 1 ? await enqueueHomeSchoolNotifications(tx, {
        where: { id: params.id }, event: 'CANCELLED', schulamtId: userSession.id,
      }) : { outboxIds: [], warnings: [] };
      // Keep every reviewed/rejected correction as an audit trail. Only legacy
      // unreported assignments retain the old delete behavior.
      if (assignment._count.hourCorrections === 0) await tx.assignment.delete({ where: { id: params.id } });
      await recalculateRequestStatus(tx, assignment.requestId);
      const outboxIds: string[] = [...home.outboxIds];
      const notificationWarnings: string[] = [...home.warnings];
      const teacherRecipient = resolveTeacherNotificationRecipient(assignment.teacher);
      if (cancelled.count === 1 && teacherRecipient) {
        const dateStr = emailDate(assignment.date);
        const queued = await enqueueEmailInTransaction(tx, {
          to: teacherRecipient,
          subject: `Einsatz storniert: ${deploymentSchoolName(assignment.request)} · ${dateStr}`,
          body: `Hallo ${assignment.teacher.name},\n\nIhre Zuweisung wurde vom Schulamt aufgehoben.\n\nBetroffene Anforderung:\n${requestEmailDetails(assignment.request, 'TEACHER')}\n\nEntfallener Einsatz:\n- ${dateStr}: ${assignment.hours} Stunde(n)\n\nBitte entfernen Sie den Termin aus Ihrem Kalender und prüfen Sie Ihr Portal für aktuelle Einsätze.`,
          schulamtId: userSession.id,
        });
        if (queued.outboxId) outboxIds.push(queued.outboxId);
        if (queued.warning) notificationWarnings.push(queued.warning);
      }
      return { outboxIds, notificationWarnings };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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
    if (error instanceof CancellationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2025'].includes(error.code)) {
      return NextResponse.json({ error: 'Der Einsatz oder seine Stundenmeldung wurde inzwischen geändert. Bitte aktualisieren und erneut prüfen.' }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Ein interner Fehler ist aufgetreten.' }, { status: 500 });
  }
}
