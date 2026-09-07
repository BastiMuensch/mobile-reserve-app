import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { sendPushNotification } from '@/lib/push';
import { formatLeaveRange } from '@/lib/leave';
import { cancelAssignmentsInLeaveRange, findOverlappingLeave, normalizeLeaveRange } from '@/lib/leaveService';
import { createLeavePreviewToken } from '@/lib/leavePreviewToken';
import { z } from 'zod';

import { isValidDateKey, parseDateKeyStrict, toCanonicalUtcDate } from '@/lib/dateKey';

// Nur der Zeitraum ist änderbar – ein Grund wird gar nicht erst erfasst (Art. 9 DSGVO,
// siehe Modell LeavePeriod in prisma/schema.prisma).
const UpdateSchema = z.object({
  startDate: z.string().refine(isValidDateKey, 'Ungültiges Datumsformat für Beginn (YYYY-MM-DD erforderlich).').optional(),
  endDate: z.string().refine(v => v === null || isValidDateKey(v), 'Ungültiges Datumsformat für Ende (YYYY-MM-DD erforderlich).').nullable().optional(),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/, 'Die Einsatzvorschau ist ungültig. Bitte erneut prüfen.'),
});

/**
 * Lädt den Zeitraum und prüft, ob der Aufrufer ihn ändern darf: die Lehrkraft ihre
 * eigenen, das Schulamt die seiner Lehrkräfte.
 */
async function loadEditable(leaveId: string, userSession: { id: string; role: string }) {
  const leave = await prisma.leavePeriod.findUnique({
    where: { id: leaveId },
    include: { teacher: { include: { stammschule: { include: { schulamt: true } }, user: true } } },
  });

  if (!leave) return { error: NextResponse.json({ error: 'Zeitraum nicht gefunden.' }, { status: 404 }) };

  if (userSession.role === 'SCHULAMT') {
    if (leave.teacher.stammschule?.schulamtId !== userSession.id) {
      return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { leave };
  }

  if (userSession.role === 'TEACHER') {
    if (leave.teacher.userId !== userSession.id) {
      return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { leave };
  }

  return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ leaveId: string }> }) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { leaveId } = await params;
    const parsed = UpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const loaded = await loadEditable(leaveId, userSession);
    if ('error' in loaded) return loaded.error;
    const leave = loaded.leave;

    const startKey = parsed.data.startDate ? parseDateKeyStrict(parsed.data.startDate) : toCanonicalUtcDate(leave.startDate);
    let endKey: Date | null = null;
    if (parsed.data.endDate === null) {
      endKey = null;
    } else if (parsed.data.endDate !== undefined) {
      endKey = parseDateKeyStrict(parsed.data.endDate);
      if (!endKey) return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
    } else {
      endKey = leave.endDate ? toCanonicalUtcDate(leave.endDate) : null;
    }
    if (!startKey) {
      return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
    }

    const { start, end } = normalizeLeaveRange(startKey, endKey);
    if (end && end < start) {
      return NextResponse.json({ error: 'Das Ende darf nicht vor dem Beginn liegen.' }, { status: 400 });
    }

    const { updated, cancelled, outboxIds, notificationWarning } = await prisma.$transaction(async (tx) => {
      // Ältere Versionen haben denselben personenbezogenen Zeitraum in jede
      // Schuljahreszeile kopiert und beim Jahreswechsel teilweise gekürzt. Alle
      // überlappenden Peer-Zeiträume sind deshalb Duplikate: Regulär konnten
      // überlappende Abwesenheiten derselben Person nie angelegt werden.
      const peerTeachers = leave.teacher.userId
        ? await tx.teacher.findMany({ where: { userId: leave.teacher.userId }, select: { id: true } })
        : [{ id: leave.teacherId }];
      const peerTeacherIds = peerTeachers.map(t => t.id);

      const duplicateLeaves = leave.teacher.userId
        ? await tx.leavePeriod.findMany({
            where: {
              teacherId: { in: peerTeacherIds },
              ...(leave.endDate ? { startDate: { lte: leave.endDate } } : {}),
              OR: [{ endDate: null }, { endDate: { gte: leave.startDate } }],
            },
            select: { id: true },
          })
        : [{ id: leave.id }];
      const ignoreIds = duplicateLeaves.map(item => item.id);

      const overlap = await findOverlappingLeave(tx, leave.teacherId, start, end, ignoreIds, leave.teacher.userId);
      if (overlap) throw new OverlapError(formatLeaveRange(overlap.startDate, overlap.endDate));

      const currentAssignments = await tx.assignment.findMany({
        where: {
          teacherId: { in: peerTeacherIds },
          status: { not: 'REJECTED' },
          date: end ? { gte: start, lte: end } : { gte: start },
        },
        select: { id: true },
      });
      if (createLeavePreviewToken(peerTeacherIds, start, end, currentAssignments.map(item => item.id)) !== parsed.data.previewToken) {
        throw new PreviewChangedError();
      }

      await tx.leavePeriod.deleteMany({
        where: { id: { in: ignoreIds.filter(id => id !== leave.id) } },
      });
      await tx.leavePeriod.update({
        where: { id: leave.id },
        data: { startDate: start, endDate: end },
      });

      const updated = await tx.leavePeriod.findUniqueOrThrow({
        where: { id: leave.id },
      });

      // Wurde der Zeitraum ausgeweitet, können jetzt Einsätze hineinfallen, die vorher
      // außerhalb lagen.
      const cancelled = await cancelAssignmentsInLeaveRange(tx, leave.teacherId, start, end, leave.teacher.userId);
      // The recipient is determined by who changes the period now, not by
      // who originally created it. `leave.reportedBy` remains historical data.
      const changedBy = userSession.role;
      const range = formatLeaveRange(updated.startDate, updated.endDate);
      const recipient = changedBy === 'TEACHER' ? leave.teacher.stammschule?.schulamt?.email : leave.teacher.user?.email;
      const queued = recipient ? await enqueueEmailInTransaction(tx, {
        to: recipient,
        subject: changedBy === 'TEACHER' ? `Längere Abwesenheit geändert: ${leave.teacher.name}` : 'Längere Abwesenheit geändert',
        body: changedBy === 'TEACHER'
          ? `Die Lehrkraft ${leave.teacher.name} hat ihre längere Abwesenheit geändert.\n\nZeitraum: ${range}\n\n${cancelled.length} Einsatz(e) wurden dadurch storniert.`
          : `Für Sie wurde eine längere Abwesenheit geändert.\n\nZeitraum: ${range}\n\n${cancelled.length > 0 ? `${cancelled.length} Einsatz(e) wurden storniert.` : 'Es wurden keine Einsätze storniert.'}`,
        schulamtId: leave.teacher.stammschule?.schulamtId || undefined,
      }) : null;
      return { updated, cancelled, outboxIds: queued?.outboxId ? [queued.outboxId] : [], notificationWarning: queued?.warning };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const notificationWarnings: string[] = [];
    if (notificationWarning) notificationWarnings.push(notificationWarning);
    const delivery = await deliverOutboxIds(outboxIds);
    if (delivery.delivered < outboxIds.length) notificationWarnings.push('Die Änderung wurde gespeichert; mindestens eine E-Mail wurde nicht sofort zugestellt. Bitte den E-Mail-Ausgang prüfen.');
    if (userSession.role === 'SCHULAMT' && leave.teacher.userId) {
      try {
        await sendPushNotification(leave.teacher.userId, {
          title: 'Längere Abwesenheit geändert',
          body: `Ihre Abwesenheit wurde auf ${formatLeaveRange(updated.startDate, updated.endDate)} geändert.`,
        });
      } catch (error) {
        console.error('Push zur geänderten Abwesenheit fehlgeschlagen:', error);
        notificationWarnings.push('Die Push-Benachrichtigung an die Lehrkraft konnte nicht zugestellt werden.');
      }
    }

    return NextResponse.json({
      leave: updated,
      cancelledAssignments: cancelled.length,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    });
  } catch (error) {
    if (error instanceof OverlapError) {
      return NextResponse.json({
        error: `Es besteht bereits eine Abwesenheit in diesem Zeitraum (${error.existingRange}).`
      }, { status: 409 });
    }
    if (error instanceof PreviewChangedError) {
      return NextResponse.json({ error: 'Die betroffenen Einsätze haben sich geändert. Bitte prüfen Sie die Vorschau erneut.' }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ error: 'Der Zeitraum wurde gleichzeitig geändert. Bitte prüfen Sie die Vorschau erneut.' }, { status: 409 });
    }
    console.error('Leave period update failed:', error);
    return NextResponse.json({ error: 'Der Zeitraum konnte nicht geändert werden.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ leaveId: string }> }) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { leaveId } = await params;
    const loaded = await loadEditable(leaveId, userSession);
    if ('error' in loaded) return loaded.error;

    // Entfernt auch überlappende Alt-Duplikate aus früheren Versionen. Neue
    // personenbezogene Zeiträume werden nur noch einmal gespeichert.
    if (loaded.leave.teacher.userId) {
      await prisma.leavePeriod.deleteMany({
        where: {
          teacher: { userId: loaded.leave.teacher.userId },
          ...(loaded.leave.endDate ? { startDate: { lte: loaded.leave.endDate } } : {}),
          OR: [{ endDate: null }, { endDate: { gte: loaded.leave.startDate } }],
        },
      });
    } else {
      await prisma.leavePeriod.delete({ where: { id: loaded.leave.id } });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Leave period deletion failed:', error);
    return NextResponse.json({ error: 'Der Zeitraum konnte nicht gelöscht werden.' }, { status: 500 });
  }
}

class OverlapError extends Error {
  existingRange: string;
  constructor(existingRange: string) {
    super('Overlapping leave period');
    this.name = 'OverlapError';
    this.existingRange = existingRange;
  }
}

class PreviewChangedError extends Error {
  constructor() { super('Leave preview changed'); this.name = 'PreviewChangedError'; }
}
