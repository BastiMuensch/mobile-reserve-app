import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import {
  validateAndCreateAssignments,
  notifyAssignment,
  formatDateKey,
  DoubleBookingError,
  OnLeaveError,
  OutsidePeriodError,
} from '@/lib/assignService';
import { z } from 'zod';

/**
 * Idealbesetzung, Schritt 2: Freigabe einer Schule.
 *
 * Der Vorschlag ist eine Momentaufnahme und kann veraltet sein - zwischen Berechnung und
 * Klick kann jemand einzeln zugewiesen oder eine Lehrkraft sich abgemeldet haben. Deshalb
 * läuft die Freigabe einer Schule in EINER Transaktion: Scheitert ein Segment, wird gar
 * nichts angelegt und die Oberfläche fordert einen neuen Vorschlag an. Eine halb
 * angewendete Freigabe wäre für das Schulamt nicht nachvollziehbar.
 */
const ApproveSchema = z.object({
  schoolId: z.string().uuid('Ungültige Schul-Kennung'),
  items: z.array(z.object({
    requestId: z.string().uuid('Ungültige Anforderungs-Kennung'),
    segments: z.array(z.object({
      teacherId: z.string().uuid('Ungültige Lehrkraft-Kennung'),
      entries: z.array(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Erwartet wird ein Datum im Format JJJJ-MM-TT.'),
        hours: z.number().positive(),
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
  if (error instanceof OutsidePeriodError) {
    return `Der Tag ${formatDateKey(error.dateKey)} liegt außerhalb des Zeitraums der Anforderung.`;
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
    const { schoolId, items } = parsed.data;

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

    try {
      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          for (const segment of item.segments) {
            try {
              await validateAndCreateAssignments(tx, {
                requestId: item.requestId,
                teacherId: segment.teacherId,
                entries: segment.entries,
              });
            } catch (error) {
              const detail = describeFailure(error, teachersById.get(segment.teacherId)?.name ?? 'Die Lehrkraft');
              if (detail) throw new ApprovalConflict(detail);
              throw error;
            }
          }
        }
      });
    } catch (error) {
      if (error instanceof ApprovalConflict) {
        return NextResponse.json({
          error: `${error.detail} Der Vorschlag ist nicht mehr aktuell - es wurde nichts übernommen. Bitte neu berechnen.`
        }, { status: 409 });
      }
      throw error;
    }

    // Erst nach dem Commit benachrichtigen; Fehler beim Versand dürfen die bereits
    // gespeicherten Zuweisungen nicht zurückrollen.
    for (const item of items) {
      const req = requestsById.get(item.requestId)!;
      for (const segment of item.segments) {
        const teacher = teachersById.get(segment.teacherId)!;
        try {
          await notifyAssignment({
            teacher,
            request: req,
            entries: segment.entries,
            schulamtId: userSession.id,
          });
        } catch (error) {
          console.error('Benachrichtigung zur Sammel-Freigabe fehlgeschlagen:', error);
        }
      }
    }

    const assignmentCount = items.reduce((sum, i) => sum + i.segments.reduce((s, seg) => s + seg.entries.length, 0), 0);
    return NextResponse.json({ success: true, requests: items.length, assignments: assignmentCount }, { status: 201 });
  } catch (error) {
    console.error('Idealbesetzung: Freigabe fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Die Freigabe konnte nicht durchgeführt werden.' }, { status: 500 });
  }
}
