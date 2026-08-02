export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { sendPushNotification } from '@/lib/push';
import { formatLeaveRange } from '@/lib/leave';
import { cancelAssignmentsInLeaveRange, findOverlappingLeave, normalizeLeaveRange } from '@/lib/leaveService';
import { z } from 'zod';

// Erfasst wird ausschließlich der Zeitraum. Ein Grund wird bewusst nicht entgegen-
// genommen (Art. 9 DSGVO, siehe Modell LeavePeriod in prisma/schema.prisma) – auch
// dann nicht, wenn ein Aufrufer zusätzliche Felder mitschickt.
const LeaveSchema = z.object({
  // Nur das Schulamt darf einen fremden Datensatz anlegen; bei der Lehrkraft wird das
  // Feld ignoriert und die eigene Kennung verwendet.
  teacherId: z.string().uuid('Ungültige Lehrkraft-Kennung').optional(),
  startDate: z.string().min(1, 'Bitte einen Beginn angeben.'),
  endDate: z.string().nullable().optional(),
});

/**
 * Ermittelt die Lehrkraft, für die gehandelt wird, und ob der Aufrufer das darf.
 * Lehrkräfte dürfen ausschließlich für sich selbst melden, das Schulamt nur für
 * Lehrkräfte seiner eigenen Schulen.
 */
async function resolveTeacher(
  userSession: { id: string; role: string },
  requestedTeacherId?: string
) {
  if (userSession.role === 'TEACHER') {
    const teacher = await prisma.teacher.findFirst({
      where: { userId: userSession.id },
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

  const leavePeriods = await prisma.leavePeriod.findMany({
    where: { teacherId: resolved.teacher.id },
    orderBy: { startDate: 'desc' },
  });

  return NextResponse.json(leavePeriods);
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const parsed = LeaveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { startDate, endDate } = parsed.data;

    const resolved = await resolveTeacher(userSession, parsed.data.teacherId);
    if ('error' in resolved) return resolved.error;
    const teacher = resolved.teacher;

    if (Number.isNaN(new Date(startDate).getTime()) || (endDate && Number.isNaN(new Date(endDate).getTime()))) {
      return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
    }

    const { start, end } = normalizeLeaveRange(startDate, endDate || null);
    if (end && end < start) {
      return NextResponse.json({ error: 'Das Ende darf nicht vor dem Beginn liegen.' }, { status: 400 });
    }

    const reportedBy = userSession.role === 'TEACHER' ? 'TEACHER' : 'SCHULAMT';

    const { leave, cancelled } = await prisma.$transaction(async (tx) => {
      const overlap = await findOverlappingLeave(tx, teacher.id, start, end);
      if (overlap) {
        throw new OverlapError(formatLeaveRange(overlap.startDate, overlap.endDate));
      }

      const leave = await tx.leavePeriod.create({
        data: { teacherId: teacher.id, startDate: start, endDate: end, reportedBy },
      });

      // Einsätze im Zeitraum stornieren, damit die betroffenen Anforderungen wieder
      // offen sind und neu besetzt werden können.
      const cancelled = await cancelAssignmentsInLeaveRange(tx, teacher.id, start, end);
      return { leave, cancelled };
    });

    await notifyAboutLeave(teacher, leave, cancelled, reportedBy);

    return NextResponse.json({ leave, cancelledAssignments: cancelled.length }, { status: 201 });
  } catch (error) {
    if (error instanceof OverlapError) {
      return NextResponse.json({
        error: `Es besteht bereits eine Abwesenheit in diesem Zeitraum (${error.existingRange}).`
      }, { status: 409 });
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
  reportedBy: string
) {
  const range = formatLeaveRange(leave.startDate, leave.endDate);
  const schulamtId = teacher.stammschule?.schulamtId || undefined;

  try {
    if (reportedBy === 'TEACHER') {
      const schulamtEmail = teacher.stammschule?.schulamt?.email;
      if (schulamtEmail) {
        await sendEmail(
          schulamtEmail,
          `Längere Abwesenheit gemeldet: ${teacher.name}`,
          `Die Lehrkraft ${teacher.name} hat eine längere Abwesenheit gemeldet.\n\n` +
          `Zeitraum: ${range}\n` +
          `\nIn diesem Zeitraum lagen ${cancelled.length} Einsätze, die automatisch storniert wurden. ` +
          `Die betroffenen Anforderungen stehen wieder zur Besetzung bereit.\n\n` +
          `Der Grund der Abwesenheit wird in der Anwendung bewusst nicht erfasst und ist ` +
          `auf dem üblichen Dienstweg zu melden.`,
          schulamtId
        );
      }
    } else if (teacher.user?.email) {
      await sendEmail(
        teacher.user.email,
        `Längere Abwesenheit eingetragen`,
        `Für Sie wurde eine längere Abwesenheit hinterlegt.\n\n` +
        `Zeitraum: ${range}\n` +
        `\nSie werden in diesem Zeitraum nicht für Einsätze eingeplant. ` +
        (cancelled.length > 0 ? `${cancelled.length} bereits geplante Einsätze wurden storniert.\n` : '') +
        `\nBitte wenden Sie sich an Ihr Schulamt, falls die Angaben nicht stimmen.`,
        schulamtId
      );
    }
  } catch (error) {
    console.error('Benachrichtigung zur längeren Abwesenheit fehlgeschlagen:', error);
  }

  if (reportedBy === 'SCHULAMT' && teacher.userId) {
    await sendPushNotification(teacher.userId, {
      title: 'Längere Abwesenheit eingetragen',
      body: `Sie sind ${range} nicht für Einsätze eingeplant.`,
    }).catch(e => console.error('Push failed:', e));
  }
}
