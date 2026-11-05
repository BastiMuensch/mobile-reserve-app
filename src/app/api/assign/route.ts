import { deploymentSchoolName } from "@/lib/schoolLocations";
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import {
  validateAndCreateAssignments,
  enqueueAssignmentEmailsInTransaction,
  notifyAssignmentPush,
  formatDateKey,
  DoubleBookingError,
  OnLeaveError,
  AbsenceConflictError,
  TeacherInactiveError,
  OnlyStammschuleError,
  HoursExceededError,
  DuplicateDayInPayloadError,
  TenantMismatchError,
  OutsidePeriodError,
  SchoolYearMismatchError,
  TimetableConflictError,
  RequestNotAssignableError,
  PlanningSettingsChangedError,
} from '@/lib/assignService';
import { isValidDateKey } from '@/lib/dateKey';
import { z } from 'zod';
import { deliverOutboxIds } from '@/lib/emailOutbox';
import { SuitabilityConfirmationRequired } from '@/lib/matchingSuitability';

const AssignmentEntriesSchema = z.array(z.object({
  date: z.string().refine(isValidDateKey, 'Ungültiges Datumsformat (YYYY-MM-DD erforderlich).'),
  hours: z.number().int().positive('Stundenzahl muss eine positive ganze Zahl sein.'),
})).min(1, 'Bitte mindestens eine Zuweisung angeben.');

const AssignSchema = z.object({
  requestId: z.string().uuid('Ungültige Anforderungs-ID'),
  teacherId: z.string().uuid('Ungültige Lehrkraft-ID'),
  allowTimetableOverride: z.boolean().default(false),
  allowSuitabilityOverride: z.boolean().default(false),
  expectedReserveShortageMode: z.boolean().optional(),
  assignments: AssignmentEntriesSchema,
  additionalAssignments: z.array(z.object({
    requestId: z.string().uuid('Ungültige Anforderungs-ID'),
    assignments: AssignmentEntriesSchema,
  })).max(20).default([]),
}).superRefine((data, ctx) => {
  const ids = [data.requestId, ...data.additionalAssignments.map(item => item.requestId)];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Jeden Bedarf bitte nur einmal auswählen.' });
  const dates = new Set(data.assignments.map(entry => entry.date));
  if (data.additionalAssignments.some(item => item.assignments.some(entry => !dates.has(entry.date)))) {
    ctx.addIssue({ code: 'custom', message: 'Zusätzliche Bedarfe müssen an den ausgewählten Einsatztagen liegen.' });
  }
});

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = AssignSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    const req = await prisma.request.findUnique({
      where: { id: data.requestId },
      include: { location: true, school: { include: { user: true } } }
    });

    if (!req) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (req.school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: Request does not belong to your Schulamt.' }, { status: 403 });
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: data.teacherId },
      include: { user: true, stammschule: true }
    });

    if (!teacher || teacher.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: Teacher does not belong to your Schulamt.' }, { status: 403 });
    }

    // Prüfungen, Anlage und Status-Neuberechnung mit Serializable Isolation und Retry bei P2034
    let assignResult: { createdCount: number; warning?: string } | null = null;
    let queuedOutboxIds: string[] = [];
    let notificationWarnings: string[] = [];
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      attempt++;
      try {
        assignResult = await prisma.$transaction(async (tx) => {
          queuedOutboxIds = [];
          notificationWarnings = [];
          const items = [{ requestId: data.requestId, assignments: data.assignments }, ...data.additionalAssignments];
          let createdCount = 0;
          const warnings: string[] = [];
          // Reload every request in this transaction. Additional selections never
          // inherit a manually confirmed qualification/timetable exception.
          let anchor: { schoolId: string; locationId: string | null } | undefined;
          for (const [index, item] of items.entries()) {
            const currentRequest = await tx.request.findUnique({
              where: { id: item.requestId }, include: { location: true, school: { include: { user: true } } },
            });
            if (!currentRequest || currentRequest.school.schulamtId !== userSession.id) {
              throw new TenantMismatchError('Der ausgewählte Bedarf gehört nicht zu Ihrem Schulamt.');
            }
            if (!anchor) anchor = currentRequest;
            if (currentRequest.schoolId !== anchor.schoolId || currentRequest.locationId !== anchor.locationId) {
              throw new TenantMismatchError('Gemeinsam besetzte Bedarfe müssen an derselben Schule und am selben Standort liegen.');
            }
            const result = await validateAndCreateAssignments(tx, {
              requestId: item.requestId,
              teacherId: data.teacherId,
              entries: item.assignments,
              schulamtId: userSession.id,
              allowTimetableOverride: index === 0 && data.allowTimetableOverride,
              allowSuitabilityOverride: index === 0 && data.allowSuitabilityOverride,
              expectedReserveShortageMode: data.expectedReserveShortageMode,
            });
            const queued = await enqueueAssignmentEmailsInTransaction(tx, {
              teacher, request: currentRequest, entries: result.entries, schulamtId: userSession.id,
              cancelledHoursByDate: result.cancelledHoursByDate,
            });
            createdCount += result.createdCount;
            if (result.warning) warnings.push(result.warning);
            queuedOutboxIds.push(...queued.outboxIds);
            notificationWarnings.push(...queued.warnings);
          }
          return { createdCount, warning: [...new Set(warnings)].join(' ') || undefined };
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        });
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 50 * attempt));
            continue;
          }
          return NextResponse.json({
            error: 'Die Zuweisung wurde durch einen gleichzeitigen Vorgang unterbrochen. Bitte versuchen Sie es erneut.'
          }, { status: 409 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return NextResponse.json({
            error: 'Konflikt: Für diese Lehrkraft existiert an mindestens einem der gewählten Tage bereits eine aktive Zuweisung.'
          }, { status: 409 });
        }
        if (error instanceof PlanningSettingsChangedError) {
          return NextResponse.json({ error: error.message }, { status: 409 });
        }
        if (error instanceof SuitabilityConfirmationRequired) {
          return NextResponse.json({ code: 'SUITABILITY_CONFIRMATION_REQUIRED', suitability: error.suitability, error: error.message }, { status: 409 });
        }
        if (error instanceof DoubleBookingError) {
          const days = error.conflictDateKeys.map(formatDateKey).join(', ');
          return NextResponse.json({
            error: `Die Lehrkraft ist an folgendem/n Tag(en) bereits verplant: ${days}.`
          }, { status: 409 });
        }
        if (error instanceof OnLeaveError) {
          const days = error.leaveDateKeys.map(formatDateKey).join(', ');
          return NextResponse.json({
            error: `Die Lehrkraft ist an folgendem/n Tag(en) längerfristig abwesend (z.B. Mutterschutz oder Elternzeit): ${days}.`
          }, { status: 409 });
        }
        if (error instanceof AbsenceConflictError) {
          const days = error.dateKeys.map(formatDateKey).join(', ');
          return NextResponse.json({
            error: `Die Lehrkraft hat für folgende(n) Tag(e) einen Ausfall gemeldet: ${days}.`
          }, { status: 409 });
        }
        if (error instanceof OnlyStammschuleError) {
          return NextResponse.json({ error: error.message }, { status: 409 });
        }
        if (error instanceof TeacherInactiveError) {
          return NextResponse.json({
            error: `Die Lehrkraft ist nicht mehr aktiv (Status: ${error.status}).`
          }, { status: 409 });
        }
        if (error instanceof HoursExceededError) {
          return NextResponse.json({
            error: `Die geforderten Stunden für ${formatDateKey(error.dateKey)} überschreiten den offenen Bedarf (${error.requestedHours} > ${error.openHours}).`
          }, { status: 400 });
        }
        if (error instanceof DuplicateDayInPayloadError) {
          return NextResponse.json({
            error: 'Mehrere Zuweisungen für denselben Tag im Payload enthalten.'
          }, { status: 400 });
        }
        if (error instanceof OutsidePeriodError) {
          return NextResponse.json({
            error: `Das Datum ${formatDateKey(error.dateKey)} liegt außerhalb des Zeitraums dieser Anforderung.`
          }, { status: 400 });
        }
        if (error instanceof SchoolYearMismatchError) {
          return NextResponse.json({
            error: 'Die Lehrkraft gehört nicht zum Schuljahr des gewählten Einsatztages. Bitte laden Sie die Kandidaten neu.'
          }, { status: 409 });
        }
        if (error instanceof TimetableConflictError) {
          return NextResponse.json({
            code: 'TIMETABLE_CONFIRMATION_REQUIRED',
            dateKeys: error.dateKeys,
            error: `Die Einsatztage oder Unterrichtsstunden weichen am ${error.dateKeys.map(formatDateKey).join(', ')} vom regulären Einsatzplan der Lehrkraft ab. Bitte die manuelle Ausnahme ausdrücklich bestätigen.`,
          }, { status: 409 });
        }
        if (error instanceof RequestNotAssignableError) {
          return NextResponse.json({ error: 'Diese Anforderung ist nicht offen für Zuweisungen. Eine als unbesetzbar markierte Anforderung muss zuerst ausdrücklich wieder geöffnet werden.' }, { status: 409 });
        }
        if (error instanceof TenantMismatchError) {
          return NextResponse.json({ error: error.message }, { status: 403 });
        }
        throw error;
      }
    }

    // Benachrichtigungen erst nach dem Commit. Delivery is operationally
    // visible in the outbox; a failure must not misreport the committed
    // assignment as an HTTP 500.
    const delivery = await deliverOutboxIds(queuedOutboxIds);
    if (delivery.delivered < queuedOutboxIds.length) {
      notificationWarnings.push('Mindestens eine E-Mail wurde nicht sofort zugestellt. Bitte den E-Mail-Ausgang prüfen.');
    }
    try {
      notificationWarnings.push(...await notifyAssignmentPush(teacher, deploymentSchoolName(req), req.school.user?.id));
    } catch (error) {
      console.error('Benachrichtigung zur Zuweisung fehlgeschlagen:', error);
      notificationWarnings.push('Die Zuweisung wurde gespeichert, aber die Push-Benachrichtigung konnte nicht verarbeitet werden.');
    }

    return NextResponse.json({
      success: true,
      count: assignResult?.createdCount ?? 0,
      assignedRequestIds: [data.requestId, ...data.additionalAssignments.map(item => item.requestId)],
      warning: assignResult?.warning,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    }, { status: 201 });
  } catch (error) {
    console.error('Zuweisung fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Failed to assign teacher' }, { status: 500 });
  }
}
