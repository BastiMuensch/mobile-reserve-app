import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403 });
  const where = { school: { schulamtId: user.id }, assignments: { some: { hourCorrections: { some: { status: 'PENDING' } } } } };
  const [requests, total] = await Promise.all([
    prisma.request.findMany({ where, take: 50, orderBy: [{ date: 'asc' }, { id: 'asc' }], select: {
      id: true, substitutedTeacher: true, school: { select: { name: true } },
      assignments: { where: { hourCorrections: { some: { status: 'PENDING' } } }, select: {
        id: true, date: true, teacher: { select: { name: true } },
      } },
    } }),
    prisma.request.count({ where }),
  ]);
  return NextResponse.json({ requests, total }, { headers: { 'Cache-Control': 'private, no-store' } });
}
