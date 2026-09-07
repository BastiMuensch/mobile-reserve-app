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
  HoursExceededError,
  DuplicateDayInPayloadError,
  TenantMismatchError,
  OutsidePeriodError,
  SchoolYearMismatchError,
  TimetableConflictError,
  RequestNotAssignableError,
} from '@/lib/assignService';
import { isValidDateKey } from '@/lib/dateKey';
import { z } from 'zod';
import { deliverOutboxIds } from '@/lib/emailOutbox';
import {
  batchPlanningSchema, getBatchPlanningWindow, areBatchEntriesInWindow,
  requireBatchOvertimeConsent, BatchOvertimeConfirmationRequired,
} from '@/lib/batchPlanning';

/**
 * Idealbesetzung, Schritt 2: Freigabe einer Schule.
 *
 * Der Vorschlag ist eine Momentaufnahme und kann veraltet sein - zwischen Berechnung und
 * Klick kann jemand einzeln zugewiesen oder eine Lehrkraft sich abgemeldet haben. Deshalb
 * läuft die Freigabe einer Schule in EINER Transaktion: Scheitert ein Segment, wird gar
 * nichts angelegt und die Oberfläche fordert einen neuen Vorschlag an. Eine halb
 * angewendete Freigabe wäre für das Schulamt nicht nachvollziehbar.
 */
const ApproveSchema = batchPlanningSchema.extend({
  schoolId: z.string().uuid('Ungültige Schul-Kennung'),
  allowOvertime: z.boolean().default(false),
  items: z.array(z.object({
    requestId: z.string().uuid('Ungültige Anforderungs-Kennung'),
    segments: z.array(z.object({
      teacherId: z.string().uuid('Ungültige Lehrkraft-Kennung'),
      entries: z.array(z.object({
        date: z.string().refine(isValidDateKey, 'Erwartet wird ein Datum im Format JJJJ-MM-TT.'),
        hours: z.number().int().positive('Stundenzahl muss eine positive ganze Zahl sein.'),
      })).min(1),
    })).min(1),
  })).min(1, 'Es wurde keine Anforderung zur Freigabe ausgewählt.'),
});

/** Fasst die Fehlerklassen des Zuweisungskerns in eine Meldung für das Schulamt. */
function describeFailure(error: unknown, teacherName: string): string | null {
  if (error instanceof DoubleBookingError) {
    return `${teacherName} ist inzwischen an folgendem/n Tag(en) verplant: ${error.conflictDateKeys.map(formatDateKey).join(', ')}.`;
  }
  if (error instanceof OnLeaveError) {
    return `${teacherName} ist an folgendem/n Tag(en) längerfristig abwesend: ${error.leaveDateKeys.map(formatDateKey).join(', ')}.`;
  }
  if (error instanceof AbsenceConflictError) {
    return `${teacherName} hat für folgende(n) Tag(e) einen Ausfall gemeldet: ${error.dateKeys.map(formatDateKey).join(', ')}.`;
  }
  if (error instanceof TeacherInactiveError) {
    return `${teacherName} ist nicht mehr aktiv (Status: ${error.status}).`;
  }
  if (error instanceof HoursExceededError) {
    return `Die geforderten Stunden für ${formatDateKey(error.dateKey)} überschreiten den offenen Bedarf (${error.requestedHours} > ${error.openHours}).`;
  }
  if (error instanceof DuplicateDayInPayloadError) {
    return `Mehrere Zuweisungen für denselben Tag bei ${teacherName} angegeben.`;
  }
  if (error instanceof OutsidePeriodError) {
    return `Der Tag ${formatDateKey(error.dateKey)} liegt außerhalb des Zeitraums der Anforderung.`;
  }
  if (error instanceof SchoolYearMismatchError) {
    return `${teacherName} gehört nicht zum Schuljahr des gewählten Einsatztages.`;
  }
  if (error instanceof TimetableConflictError) {
    return `Der Stundenplan von ${teacherName} deckt die benötigten Unterrichtsstunden am ${formatDateKey(error.dateKey)} nicht ab.`;
  }
  if (error instanceof RequestNotAssignableError) {
    return 'Die Anforderung ist nicht mehr offen für Zuweisungen.';
  }
  if (error instanceof TenantMismatchError) {
    return error.message;
  }
  return null;
}

class ApprovalConflict extends Error {
  detail: string;
  constructor(detail: string) {
    super('Approval conflict');
    this.name = 'ApprovalConflict';
    this.detail = detail;
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = ApproveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { schoolId, items, allowOvertime } = parsed.data;
    try {
      const window = getBatchPlanningWindow(parsed.data);
      if (!areBatchEntriesInWindow(items.flatMap(item => item.segments.flatMap(segment => segment.entries)), window)) {
        return NextResponse.json({ error: 'Der Vorschlag enthält Tage außerhalb des aktuellen Planungszeitraums. Bitte neu berechnen.' }, { status: 409 });
      }
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      include: { user: true },
    });
    if (!school) {
      return NextResponse.json({ error: 'Schule nicht gefunden.' }, { status: 404 });
    }
    if (school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Diese Schule gehört nicht zu Ihrem Schulamt.' }, { status: 403 });
    }

    // Alle Anforderungen müssen zu dieser Schule gehören, alle Lehrkräfte zu diesem
    // Schulamt - sonst ließe sich über einen manipulierten Aufruf fremd zugewiesen.
    const requestIds = items.map(i => i.requestId);
    const requests = await prisma.request.findMany({
      where: { id: { in: requestIds } },
      include: { school: { include: { user: true } } },
    });
    if (requests.length !== requestIds.length || requests.some(r => r.schoolId !== schoolId)) {
      return NextResponse.json({ error: 'Eine Anforderung gehört nicht zu dieser Schule.' }, { status: 403 });
    }
    if (requests.some(r => r.status !== 'PENDING' && r.status !== 'PARTIALLY_FILLED')) {
      return NextResponse.json({
        error: 'Mindestens eine Anforderung ist nicht mehr offen. Bitte den Vorschlag neu berechnen.'
      }, { status: 409 });
    }

    const teacherIds = Array.from(new Set(items.flatMap(i => i.segments.map(s => s.teacherId))));
    const teachers = await prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      include: { user: true, stammschule: true },
    });
    if (teachers.length !== teacherIds.length || teachers.some(t => t.stammschule?.schulamtId !== userSession.id)) {
      return NextResponse.json({ error: 'Eine Lehrkraft gehört nicht zu Ihrem Schulamt.' }, { status: 403 });
    }

    const teachersById = new Map(teachers.map(t => [t.id, t]));
    const requestsById = new Map(requests.map(r => [r.id, r]));

    const warnings: string[] = [];
    let queuedOutboxIds: string[] = [];
    let queuedNotificationWarnings: string[] = [];
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      attempt++;
      try {
        warnings.length = 0;
        queuedOutboxIds = [];
        queuedNotificationWarnings = [];
        await prisma.$transaction(async (tx) => {
          for (const item of items) {
            for (const segment of item.segments) {
              try {
                const res = await validateAndCreateAssignments(tx, {
                  requestId: item.requestId,
                  teacherId: segment.teacherId,
                  entries: segment.entries,
                  schulamtId: userSession.id,
                });
                if (res.warning) warnings.push(`${teachersById.get(segment.teacherId)?.name ?? 'Die Lehrkraft'}: ${res.warning}`);
                const queued = await enqueueAssignmentEmailsInTransaction(tx, {
                  teacher: teachersById.get(segment.teacherId)!,
                  request: requestsById.get(item.requestId)!,
                  entries: segment.entries,
                  schulamtId: userSession.id,
                });
                queuedOutboxIds.push(...queued.outboxIds);
                queuedNotificationWarnings.push(...queued.warnings);
              } catch (error) {
                const detail = describeFailure(error, teachersById.get(segment.teacherId)?.name ?? 'Die Lehrkraft');
                if (detail) throw new ApprovalConflict(detail);
                throw error;
              }
            }
          }
          requireBatchOvertimeConsent(warnings, allowOvertime);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        });
        break;
      } catch (error) {
        if (error instanceof BatchOvertimeConfirmationRequired) {
          return NextResponse.json({
            code: 'OVERTIME_CONFIRMATION_REQUIRED', error: error.message, warnings: error.warnings,
          }, { status: 409 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 50 * attempt));
            continue;
          }
          return NextResponse.json({
            error: 'Die Sammel-Freigabe wurde durch gleichzeitige Änderungen unterbrochen. Bitte neu berechnen.'
          }, { status: 409 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return NextResponse.json({
            error: 'Konflikt: Mindestens eine Lehrkraft ist an einem der gewählten Tage bereits aktiv zugewiesen.'
          }, { status: 409 });
        }
        if (error instanceof ApprovalConflict) {
          return NextResponse.json({
            error: `${error.detail} Der Vorschlag ist nicht mehr aktuell - es wurde nichts übernommen. Bitte neu berechnen.`
          }, { status: 409 });
        }
        throw error;
      }
    }

    // Erst nach dem Commit benachrichtigen; Fehler beim Versand dürfen die bereits
    // gespeicherten Zuweisungen nicht zurückrollen.
    const notificationWarnings: string[] = [...queuedNotificationWarnings];
    const delivery = await deliverOutboxIds(queuedOutboxIds);
    if (delivery.delivered < queuedOutboxIds.length) {
      notificationWarnings.push('Mindestens eine E-Mail wurde nicht sofort zugestellt. Bitte den E-Mail-Ausgang prüfen.');
    }
    for (const item of items) {
      const req = requestsById.get(item.requestId)!;
      for (const segment of item.segments) {
        const teacher = teachersById.get(segment.teacherId)!;
        try {
          notificationWarnings.push(...await notifyAssignmentPush(teacher, req.school.name));
        } catch (error) {
          console.error('Benachrichtigung zur Sammel-Freigabe fehlgeschlagen:', error);
          notificationWarnings.push('Eine gespeicherte Zuweisung konnte nicht benachrichtigt werden.');
        }
      }
    }

    const assignmentCount = items.reduce((sum, i) => sum + i.segments.reduce((s, seg) => s + seg.entries.length, 0), 0);
    return NextResponse.json({
      success: true,
      requests: items.length,
      assignments: assignmentCount,
      warnings: warnings.length > 0 ? warnings : undefined,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    }, { status: 201 });
  } catch (error) {
    console.error('Idealbesetzung: Freigabe fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Die Freigabe konnte nicht durchgeführt werden.' }, { status: 500 });
  }
}
