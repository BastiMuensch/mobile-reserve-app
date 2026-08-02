import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { formatLeaveRange } from '@/lib/leave';
import { cancelAssignmentsInLeaveRange, findOverlappingLeave, normalizeLeaveRange } from '@/lib/leaveService';
import { z } from 'zod';

// Nur der Zeitraum ist änderbar – ein Grund wird gar nicht erst erfasst (Art. 9 DSGVO,
// siehe Modell LeavePeriod in prisma/schema.prisma).
const UpdateSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
});

/**
 * Lädt den Zeitraum und prüft, ob der Aufrufer ihn ändern darf: die Lehrkraft ihre
 * eigenen, das Schulamt die seiner Lehrkräfte.
 */
async function loadEditable(leaveId: string, userSession: { id: string; role: string }) {
  const leave = await prisma.leavePeriod.findUnique({
    where: { id: leaveId },
    include: { teacher: { include: { stammschule: true } } },
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

    const nextStartRaw = parsed.data.startDate ?? leave.startDate;
    // Unterschieden wird zwischen "Feld nicht mitgeschickt" (Ende bleibt) und
    // "ausdrücklich null" (Ende wird entfernt, Zeitraum läuft bis auf Weiteres).
    const nextEndRaw = parsed.data.endDate === undefined ? leave.endDate : parsed.data.endDate;

    if (Number.isNaN(new Date(nextStartRaw).getTime()) || (nextEndRaw && Number.isNaN(new Date(nextEndRaw).getTime()))) {
      return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
    }

    const { start, end } = normalizeLeaveRange(nextStartRaw, nextEndRaw);
    if (end && end < start) {
      return NextResponse.json({ error: 'Das Ende darf nicht vor dem Beginn liegen.' }, { status: 400 });
    }

    const { updated, cancelled } = await prisma.$transaction(async (tx) => {
      const overlap = await findOverlappingLeave(tx, leave.teacherId, start, end, leave.id);
      if (overlap) throw new OverlapError(formatLeaveRange(overlap.startDate, overlap.endDate));

      const updated = await tx.leavePeriod.update({
        where: { id: leave.id },
        data: { startDate: start, endDate: end },
      });

      // Wurde der Zeitraum ausgeweitet, können jetzt Einsätze hineinfallen, die vorher
      // außerhalb lagen. Ein Verkürzen macht bereits stornierte Einsätze bewusst nicht
      // rückgängig – die Anforderungen sind wieder offen und ggf. neu besetzt.
      const cancelled = await cancelAssignmentsInLeaveRange(tx, leave.teacherId, start, end);
      return { updated, cancelled };
    });

    return NextResponse.json({ leave: updated, cancelledAssignments: cancelled.length });
  } catch (error) {
    if (error instanceof OverlapError) {
      return NextResponse.json({
        error: `Es besteht bereits eine Abwesenheit in diesem Zeitraum (${error.existingRange}).`
      }, { status: 409 });
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

    // Bereits stornierte Einsätze werden nicht wiederhergestellt: sie können in der
    // Zwischenzeit anderweitig besetzt worden sein.
    await prisma.leavePeriod.delete({ where: { id: loaded.leave.id } });
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
