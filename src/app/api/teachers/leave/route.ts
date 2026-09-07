export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { sendPushNotification } from '@/lib/push';
import { formatLeaveRange } from '@/lib/leave';
import { cancelAssignmentsInLeaveRange, findOverlappingLeave, normalizeLeaveRange } from '@/lib/leaveService';
import { z } from 'zod';
import { createLeavePreviewToken } from '@/lib/leavePreviewToken';
import { getCurrentSchoolYear, getSchoolYearForDate } from '@/lib/schoolYear';

import { isValidDateKey, parseDateKeyStrict, toCanonicalUtcDate } from '@/lib/dateKey';

// Erfasst wird ausschließlich der Zeitraum. Ein Grund wird bewusst nicht entgegen-
// genommen (Art. 9 DSGVO, siehe Modell LeavePeriod in prisma/schema.prisma) – auch
// dann nicht, wenn ein Aufrufer zusätzliche Felder mitschickt.
const LeaveSchema = z.object({
  // Nur das Schulamt darf einen fremden Datensatz anlegen; bei der Lehrkraft wird das
  // Feld ignoriert und die eigene Kennung verwendet.
  teacherId: z.string().uuid('Ungültige Lehrkraft-Kennung').optional(),
  startDate: z.string().refine(isValidDateKey, 'Ungültiges Datumsformat für Beginn (YYYY-MM-DD erforderlich).'),
  endDate: z.string().refine(v => v === null || isValidDateKey(v), 'Ungültiges Datumsformat für Ende (YYYY-MM-DD erforderlich).').nullable().optional(),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/, 'Die Einsatzvorschau ist ungültig. Bitte erneut prüfen.'),
});


/**
 * Ermittelt die Lehrkraft, für die gehandelt wird, und ob der Aufrufer das darf.
 * Lehrkräfte dürfen ausschließlich für sich selbst melden, das Schulamt nur für
 * Lehrkräfte seiner eigenen Schulen.
 */
async function resolveTeacher(
  userSession: { id: string; role: string },
  requestedTeacherId?: string,
  schoolYear = getCurrentSchoolYear(),
) {
  if (userSession.role === 'TEACHER') {
    const teacher = await prisma.teacher.findFirst({
      where: { userId: userSession.id, schoolYear },
      include: { stammschule: { include: { schulamt: true } }, user: true },
    });
    if (!teacher) return { error: NextResponse.json({ error: 'Lehrkraft nicht gefunden.' }, { status: 404 }) };
    return { teacher };
  }

  if (userSession.role === 'SCHULAMT') {
    if (!requestedTeacherId) {
      return { error: NextResponse.json({ error: 'Bitte eine Lehrkraft angeben.' }, { status: 400 }) };
    }
    const teacher = await prisma.teacher.findUnique({
      where: { id: requestedTeacherId },
      include: { stammschule: { include: { schulamt: true } }, user: true },
    });
    if (!teacher || teacher.stammschule?.schulamtId !== userSession.id) {
      return { error: NextResponse.json({ error: 'Diese Lehrkraft gehört nicht zu Ihrem Schulamt.' }, { status: 403 }) };
    }
    return { teacher };
  }

  return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
}

export async function GET(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const resolved = await resolveTeacher(userSession, searchParams.get('teacherId') ?? undefined);
  if ('error' in resolved) return resolved.error;

  const teacherIds = resolved.teacher.userId
    ? (await prisma.teacher.findMany({ where: { userId: resolved.teacher.userId }, select: { id: true } })).map(t => t.id)
    : [resolved.teacher.id];

  const leavePeriods = await prisma.leavePeriod.findMany({
    where: { teacherId: { in: teacherIds } },
    orderBy: { startDate: 'desc' },
  });

  // Deduplicate identical intervals across school years
  const seen = new Set<string>();
  const deduplicated = leavePeriods.filter(lp => {
    const key = `${toCanonicalUtcDate(lp.startDate).toISOString()}_${lp.endDate ? toCanonicalUtcDate(lp.endDate).toISOString() : 'open'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json(deduplicated);
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const parsed = LeaveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { startDate, endDate, previewToken: expectedPreviewToken } = parsed.data;

    const startParsed = parseDateKeyStrict(startDate);
    const endParsed = endDate ? parseDateKeyStrict(endDate) : null;
    if (!startParsed || (endDate && !endParsed)) {
      return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
    }

    const { start, end } = normalizeLeaveRange(startParsed, endParsed);
    if (end && end < start) {
      return NextResponse.json({ error: 'Das Ende darf nicht vor dem Beginn liegen.' }, { status: 400 });
    }

    const resolved = await resolveTeacher(
      userSession,
      parsed.data.teacherId,
      getSchoolYearForDate(start),
    );
    if ('error' in resolved) return resolved.error;
    const teacher = resolved.teacher;

    const reportedBy = userSession.role === 'TEACHER' ? 'TEACHER' : 'SCHULAMT';

    const { leave, cancelled, outboxIds, notificationWarning } = await prisma.$transaction(async (tx) => {
      const overlap = await findOverlappingLeave(tx, teacher.id, start, end, undefined, teacher.userId);
      if (overlap) {
        throw new OverlapError(formatLeaveRange(overlap.startDate, overlap.endDate));
      }
      const teacherIds = teacher.userId
        ? (await tx.teacher.findMany({ where: { userId: teacher.userId }, select: { id: true } })).map(item => item.id)
        : [teacher.id];
      const currentAssignments = await tx.assignment.findMany({
        where: { teacherId: { in: teacherIds }, status: { not: 'REJECTED' }, date: end ? { gte: start, lte: end } : { gte: start } },
        select: { id: true },
      });
      if (createLeavePreviewToken(teacherIds, start, end, currentAssignments.map(assignment => assignment.id)) !== expectedPreviewToken) {
        throw new PreviewChangedError();
      }

      // Ein Zeitraum wird nur einmal gespeichert. Matching und Zuweisung suchen
      // bei Konten mit userId ohnehin über alle Schuljahreszeilen derselben Person.
      // Mehrfachkopien würden bei einer späteren Änderung auseinanderlaufen und
      // könnten als veraltete Sperren bestehen bleiben.
      const leave = await tx.leavePeriod.create({
        data: { teacherId: teacher.id, startDate: start, endDate: end, reportedBy },
      });

      // Einsätze im Zeitraum stornieren, damit die betroffenen Anforderungen wieder
      // offen sind und neu besetzt werden können.
      const cancelled = await cancelAssignmentsInLeaveRange(tx, teacher.id, start, end, teacher.userId);
      const range = formatLeaveRange(leave.startDate, leave.endDate);
      const recipient = reportedBy === 'TEACHER' ? teacher.stammschule?.schulamt?.email : teacher.user?.email;
      const subject = reportedBy === 'TEACHER' ? `Längere Abwesenheit gemeldet: ${teacher.name}` : 'Längere Abwesenheit eingetragen';
      const body = reportedBy === 'TEACHER'
        ? `Die Lehrkraft ${teacher.name} hat eine längere Abwesenheit gemeldet.\n\nZeitraum: ${range}\n\nIn diesem Zeitraum lagen ${cancelled.length} Einsätze, die automatisch storniert wurden. Die betroffenen Anforderungen stehen wieder zur Besetzung bereit.`
        : `Für Sie wurde eine längere Abwesenheit hinterlegt.\n\nZeitraum: ${range}\n\nSie werden in diesem Zeitraum nicht für Einsätze eingeplant.`;
      const queued = recipient ? await enqueueEmailInTransaction(tx, { to: recipient, subject, body, schulamtId: teacher.stammschule?.schulamtId || undefined }) : null;
      return {
        leave,
        cancelled,
        outboxIds: queued?.outboxId ? [queued.outboxId] : [],
        notificationWarning: queued?.warning,
      };
    }, { isolationLevel: 'Serializable' });

    const notificationWarnings = await notifyAboutLeave(teacher, leave, cancelled, reportedBy, outboxIds);
    if (notificationWarning) notificationWarnings.unshift(notificationWarning);

    return NextResponse.json({
      leave,
      cancelledAssignments: cancelled.length,
      notificationWarning: notificationWarnings.length > 0,
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof OverlapError) {
      return NextResponse.json({
        error: `Es besteht bereits eine Abwesenheit in diesem Zeitraum (${error.existingRange}).`
      }, { status: 409 });
    }
    if (error instanceof PreviewChangedError) {
      return NextResponse.json({ error: 'Die betroffenen Einsätze haben sich geändert. Bitte prüfen Sie die Vorschau erneut.' }, { status: 409 });
    }
    console.error('Leave period creation failed:', error);
    return NextResponse.json({ error: 'Der Abwesenheitszeitraum konnte nicht gespeichert werden.' }, { status: 500 });
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

type TeacherWithContacts = {
  id: string;
  name: string;
  stammschule: { schulamtId: string | null; schulamt: { email: string } | null } | null;
  user: { email: string } | null;
  userId: string | null;
};

/**
 * Informiert die jeweils andere Seite: meldet die Lehrkraft selbst, geht die Nachricht
 * ans Schulamt – trägt das Schulamt ein, geht sie an die Lehrkraft. Fehler beim Versand
 * dürfen den bereits gespeicherten Zeitraum nicht zu Fall bringen.
 */
async function notifyAboutLeave(
  teacher: TeacherWithContacts,
  leave: { startDate: Date; endDate: Date | null },
  cancelled: { id: string }[],
  reportedBy: string,
  outboxIds: string[],
): Promise<string[]> {
  const warnings: string[] = [];
  const range = formatLeaveRange(leave.startDate, leave.endDate);

  const delivery = await deliverOutboxIds(outboxIds);
  if (outboxIds.length > 0 && delivery.delivered !== outboxIds.length) warnings.push('Die Abwesenheit wurde gespeichert, aber die E-Mail wurde nicht sofort zugestellt.');

  if (reportedBy === 'SCHULAMT' && teacher.userId) {
    const pushed = await sendPushNotification(teacher.userId, {
      title: 'Längere Abwesenheit eingetragen',
      body: `Sie sind ${range} nicht für Einsätze eingeplant.`,
    }).then(() => true).catch(e => {
      console.error('Push failed:', e);
      return false;
    });
    if (!pushed) warnings.push('Die Push-Benachrichtigung an die Lehrkraft konnte nicht zugestellt werden.');
  }
  return warnings;
}
