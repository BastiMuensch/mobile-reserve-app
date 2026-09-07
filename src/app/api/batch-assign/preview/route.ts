export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { buildBatchProposal } from '@/lib/batchMatching';
import { parseDateKeyStrict, toLocalDateInputValue } from '@/lib/dateKey';
import { getOpenRequestDays } from '@/lib/requestDays';
import { batchPlanningSchema, getBatchPlanningWindow } from '@/lib/batchPlanning';

/**
 * Idealbesetzung, Schritt 1: Vorschlag berechnen.
 *
 * Bewusst zustandslos - es wird nichts gespeichert. Der Vorschlag ist eine Momentaufnahme;
 * bei der Freigabe (siehe ../approve) prüft der Server ohnehin alles noch einmal gegen den
 * dann aktuellen Stand. Das erspart ein weiteres Datenmodell samt Veraltungs-Logik.
 */
const PreviewSchema = batchPlanningSchema;

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

    const now = new Date();
    let window;
    try {
      window = getBatchPlanningWindow(parsed.data, now);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    const until = parseDateKeyStrict(window.until);
    const from = parseDateKeyStrict(window.from);
    const [todayYear, todayMonth, todayDay] = toLocalDateInputValue(now).split('-').map(Number);
    const planningToday = new Date(todayYear, todayMonth - 1, todayDay);
    const metadata = { ...window, generatedAt: now.toISOString() };

    const schools = await prisma.school.findMany({ where: { schulamtId: userSession.id } });
    if (schools.length === 0) {
      return NextResponse.json({ schools: [], requestsById: {}, ...metadata });
    }
    const schoolIds = schools.map(s => s.id);

    // Nur offene Anforderungen bis zum Stichtag - die Filterung nach Status passiert
    // zusätzlich im Algorithmus, hier geht es um die Datenmenge.
    const untilEnd = new Date(until);
    untilEnd.setUTCHours(23, 59, 59, 999);
    const loadedRequests = await prisma.request.findMany({
      where: {
        schoolId: { in: schoolIds },
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
        date: { lte: untilEnd },
        OR: [
          { endDate: { gte: from } },
          { endDate: null, isOpenEnded: true, OR: [{ endedAt: null }, { endedAt: { gte: from } }] },
          { endDate: null, isOpenEnded: false, date: { gte: from } },
        ],
      },
      include: { assignments: true, school: true },
      orderBy: { date: 'asc' },
    });

    const requests = loadedRequests.filter(item => getOpenRequestDays(item, item.assignments, planningToday)
      .some(day => day.date >= window.from && day.date <= window.until));
    const teachers = await prisma.teacher.findMany({
      where: {
        stammschule: { schulamtId: userSession.id },
        schoolYear: window.schoolYear,
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
        where: { teacherId: { in: teacherIds }, date: { gte: from, lte: untilEnd } },
        select: { teacherId: true, date: true },
      }),
      prisma.leavePeriod.findMany({
        where: {
          OR: [
            { teacherId: { in: teacherIds } },
            ...(userIds.length > 0 ? [{ teacher: { userId: { in: userIds } } }] : []),
          ],
          AND: [
            { startDate: { lte: untilEnd } },
            { OR: [{ endDate: null }, { endDate: { gte: from } }] },
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
      today: now,
      schoolYear: window.schoolYear,
      requests,
      schools,
      teachers,
      absences,
      leavePeriods,
    });

    // Die Anforderungen einmal mitliefern, damit die Oberfläche Datum, Stunden und
    // Qualifikation anzeigen kann, ohne sie erneut zu laden.
    const requestsById = Object.fromEntries(requests.map(r => [r.id, r]));

    return NextResponse.json({ schools: proposal, requestsById, ...metadata });
  } catch (error) {
    console.error('Idealbesetzung: Vorschlag fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Der Vorschlag konnte nicht berechnet werden.' }, { status: 500 });
  }
}
