export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { buildBatchProposal } from '@/lib/batchMatching';
import { toLocalDayStart } from '@/lib/matching';
import { z } from 'zod';

/**
 * Idealbesetzung, Schritt 1: Vorschlag berechnen.
 *
 * Bewusst zustandslos - es wird nichts gespeichert. Der Vorschlag ist eine Momentaufnahme;
 * bei der Freigabe (siehe ../approve) prüft der Server ohnehin alles noch einmal gegen den
 * dann aktuellen Stand. Das erspart ein weiteres Datenmodell samt Veraltungs-Logik.
 */
const PreviewSchema = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Erwartet wird ein Datum im Format JJJJ-MM-TT.'),
});

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = PreviewSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const until = toLocalDayStart(parsed.data.until);
    if (Number.isNaN(until.getTime())) {
      return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
    }
    const today = toLocalDayStart(new Date());
    if (until < today) {
      return NextResponse.json({ error: 'Der Stichtag darf nicht in der Vergangenheit liegen.' }, { status: 400 });
    }

    const schools = await prisma.school.findMany({ where: { schulamtId: userSession.id } });
    if (schools.length === 0) {
      return NextResponse.json({ schools: [], requestsById: {} });
    }
    const schoolIds = schools.map(s => s.id);

    // Nur offene Anforderungen bis zum Stichtag - die Filterung nach Status passiert
    // zusätzlich im Algorithmus, hier geht es um die Datenmenge.
    const untilEnd = new Date(until);
    untilEnd.setHours(23, 59, 59, 999);
    const requests = await prisma.request.findMany({
      where: {
        schoolId: { in: schoolIds },
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
        date: { lte: untilEnd },
      },
      include: { assignments: true, school: true },
      orderBy: { date: 'asc' },
    });

    const teachers = await prisma.teacher.findMany({
      where: { stammschule: { schulamtId: userSession.id } },
      include: { assignments: { select: { hours: true, date: true, status: true } } },
    });
    const teacherIds = teachers.map(t => t.id);

    const [absences, leavePeriods] = await Promise.all([
      prisma.absence.findMany({
        where: { teacherId: { in: teacherIds } },
        select: { teacherId: true, date: true },
      }),
      prisma.leavePeriod.findMany({
        where: {
          teacherId: { in: teacherIds },
          OR: [{ endDate: null }, { endDate: { gte: today } }],
        },
        select: { teacherId: true, startDate: true, endDate: true },
      }),
    ]);

    const proposal = buildBatchProposal({
      until,
      requests,
      schools,
      teachers,
      absences,
      leavePeriods,
    });

    // Die Anforderungen einmal mitliefern, damit die Oberfläche Datum, Stunden und
    // Qualifikation anzeigen kann, ohne sie erneut zu laden.
    const requestsById = Object.fromEntries(requests.map(r => [r.id, r]));

    return NextResponse.json({ schools: proposal, requestsById });
  } catch (error) {
    console.error('Idealbesetzung: Vorschlag fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Der Vorschlag konnte nicht berechnet werden.' }, { status: 500 });
  }
}
