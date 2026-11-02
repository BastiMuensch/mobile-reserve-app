import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (!['SCHOOL', 'SCHULAMT'].includes(user.role)) return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403 });
  const { id } = await params;
  const owned = await prisma.request.findFirst({ where: {
    id, ...(user.role === 'SCHOOL' ? { schoolId: user.schoolId ?? '' } : { school: { schulamtId: user.id } }),
  }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: 'Anforderung nicht gefunden.' }, { status: 404 });
  const assignments = await prisma.assignment.findMany({
    where: { requestId: id }, orderBy: [{ date: 'desc' }, { id: 'asc' }],
    select: {
      id: true, date: true, hours: true, actualHours: true, actualAdditionalMinutes: true, status: true,
      teacher: { select: { name: true } },
      hourCorrections: { orderBy: { createdAt: 'desc' }, select: {
        id: true, plannedHours: true, previousActualHours: true, previousAdditionalMinutes: true,
        proposedHours: true, additionalMinutes: true, additionalTasks: true, reason: true,
        status: true, createdAt: true, reviewedAt: true, reviewNote: true,
      } },
    },
  });
  return NextResponse.json({ assignments, role: user.role }, { headers: { 'Cache-Control': 'private, no-store' } });
}
