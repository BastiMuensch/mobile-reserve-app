export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { buildBatchProposal } from '@/lib/batchMatching';
import { toLocalDayStart } from '@/lib/matching';
import { z } from 'zod';
import { getSchoolYearForDate } from '@/lib/schoolYear';
import { isValidDateKey, parseDateKeyStrict } from '@/lib/dateKey';

/**
 * Idealbesetzung, Schritt 1: Vorschlag berechnen.
 *
 * Bewusst zustandslos - es wird nichts gespeichert. Der Vorschlag ist eine Momentaufnahme;
 * bei der Freigabe (siehe ../approve) prüft der Server ohnehin alles noch einmal gegen den
 * dann aktuellen Stand. Das erspart ein weiteres Datenmodell samt Veraltungs-Logik.
 */
const PreviewSchema = z.object({
  until: z.string().refine(isValidDateKey, 'Erwartet wird ein gültiges Datum im Format JJJJ-MM-TT.'),
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

    const until = parseDateKeyStrict(parsed.data.until);
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

    const requestSchoolYears = Array.from(new Set(requests.map(item => getSchoolYearForDate(item.date))));
    const teachers = await prisma.teacher.findMany({
      where: {
        stammschule: { schulamtId: userSession.id },
        schoolYear: { in: requestSchoolYears },
      },
      include: { assignments: { select: { hours: true, date: true, status: true } } },
    });
    const teacherIds = teachers.map(t => t.id);
    const userIds = teachers.map(t => t.userId).filter((id): id is string => Boolean(id));
    const userToTeacherIds = new Map<string, string[]>();
    for (const t of teachers) {
      if (t.userId) {
        const list = userToTeacherIds.get(t.userId);
        if (list) list.push(t.id);
        else userToTeacherIds.set(t.userId, [t.id]);
      }
    }

    const [absences, rawLeaves] = await Promise.all([
      prisma.absence.findMany({
        where: { teacherId: { in: teacherIds } },
        select: { teacherId: true, date: true },
      }),
      prisma.leavePeriod.findMany({
        where: {
          OR: [
            { teacherId: { in: teacherIds } },
            ...(userIds.length > 0 ? [{ teacher: { userId: { in: userIds } } }] : []),
          ],
          AND: [
            { OR: [{ endDate: null }, { endDate: { gte: today } }] },
          ],
        },
        select: {
          teacherId: true,
          startDate: true,
          endDate: true,
          teacher: { select: { userId: true } },
        },
      }),
    ]);

    const leavePeriods: { teacherId: string; startDate: Date; endDate: Date | null }[] = [];
    for (const l of rawLeaves) {
      if (teacherIds.includes(l.teacherId)) {
        leavePeriods.push({ teacherId: l.teacherId, startDate: l.startDate, endDate: l.endDate });
      }
      if (l.teacher?.userId && userToTeacherIds.has(l.teacher.userId)) {
        for (const tid of userToTeacherIds.get(l.teacher.userId)!) {
          if (tid !== l.teacherId) {
            leavePeriods.push({ teacherId: tid, startDate: l.startDate, endDate: l.endDate });
          }
        }
      }
    }

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
