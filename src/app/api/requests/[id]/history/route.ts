import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isValidDateKey, toLocalDateInputValue } from '@/lib/dateKey';
import { historyDateRange, normalizedHistoryClass, requestAssignmentHistory } from '@/lib/requestAssignmentHistory';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Kein Zugriff auf diesen Verlauf.' }, { status: 403 });
  const before = new URL(request.url).searchParams.get('before') || toLocalDateInputValue();
  if (!isValidDateKey(before)) return NextResponse.json({ error: 'Ungültiger Einsatztag.' }, { status: 400 });
  const row = await prisma.request.findUnique({ where: { id: (await params).id }, select: {
    id: true, schoolId: true, locationId: true, className: true, school: { select: { schulamtId: true } },
  } });
  if (!row) return NextResponse.json({ error: 'Anforderung nicht gefunden.' }, { status: 404 });
  if (row.school.schulamtId !== user.id) return NextResponse.json({ error: 'Kein Zugriff auf diese Anforderung.' }, { status: 403 });
  const assignmentScope = {
    date: historyDateRange(before), status: { in: ['PENDING', 'ACCEPTED'] }, hours: { gt: 0 },
  };
  const className = normalizedHistoryClass(row.className);
  const requests = className ? await prisma.request.findMany({ where: {
    schoolId: row.schoolId, locationId: row.locationId, className: { not: null },
    school: { schulamtId: user.id }, assignments: { some: assignmentScope },
  }, select: { id: true, className: true } }) : [];
  const requestIds = [...new Set([row.id, ...requests.filter(other => normalizedHistoryClass(other.className) === className).map(other => other.id)])];
  const assignments = await prisma.assignment.findMany({ where: {
    ...assignmentScope, requestId: { in: requestIds }, request: { school: { schulamtId: user.id } },
  }, select: {
    id: true, date: true, teacherId: true, hours: true, status: true,
    teacher: { select: { name: true } },
    request: { select: { id: true, schoolId: true, locationId: true, className: true, status: true } },
  }, orderBy: { date: 'desc' } });
  return NextResponse.json({ entries: requestAssignmentHistory(row, assignments, before), before }, { headers: { 'Cache-Control': 'private, no-store' } });
}
