import { deploymentSchoolName } from "@/lib/schoolLocations";
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCurrentSchoolYear, getSchoolYearDates } from '@/lib/schoolYear';
import { toLocalDateInputValue } from '@/lib/dateKey';
import { groupReserveAssignments, type SchoolReservesData } from '@/lib/schoolReserves';

const headers = { 'Cache-Control': 'private, no-store' };
const preferenceSchema = z.object({ reserveNotificationsEnabled: z.boolean() }).strict();

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401, headers });
  if (user.role !== 'SCHOOL' || !user.schoolId || !user.school) return NextResponse.json({ error: 'Nur für Schulkonten verfügbar.' }, { status: 403, headers });
  try {
    const schoolYear = getCurrentSchoolYear();
    const { start, end } = getSchoolYearDates(schoolYear);
    const today = toLocalDateInputValue();
    const school = await prisma.school.findUnique({
      where: { id: user.schoolId },
      select: {
        name: true,
        reserveNotificationsEnabled: true,
        teachers: {
          where: { schoolYear },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            assignments: {
              where: {
                date: { gte: start, lte: end },
                // A malformed cross-office assignment must never disclose the other tenant.
                request: user.school.schulamtId ? { school: { schulamtId: user.school.schulamtId } } : { schoolId: user.schoolId },
              },
              select: {
                id: true, requestId: true, date: true, hours: true, status: true,
                request: { select: { status: true, location: { select: { name: true } }, school: { select: { id: true, name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!school) return NextResponse.json({ error: 'Schule nicht gefunden.' }, { status: 404, headers });
    const data: SchoolReservesData = {
      schoolYear, today, schoolName: school.name,
      reserveNotificationsEnabled: school.reserveNotificationsEnabled,
      notificationEmail: user.email,
      teachers: school.teachers.map(teacher => ({
        id: teacher.id, name: teacher.name,
        assignments: groupReserveAssignments(teacher.assignments.map(assignment => ({
          id: assignment.id, requestId: assignment.requestId, date: assignment.date, hours: assignment.hours,
          status: assignment.request.status === 'CANCELLED' ? 'REJECTED' : assignment.status,
          school: { ...assignment.request.school, name: deploymentSchoolName(assignment.request) },
        })), today),
      })),
    };
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error('Could not load school reserves:', error);
    return NextResponse.json({ error: 'Die Mobilen Reserven konnten nicht geladen werden.' }, { status: 500, headers });
  }
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401, headers });
  if (user.role !== 'SCHOOL' || !user.schoolId) return NextResponse.json({ error: 'Nur für Schulkonten verfügbar.' }, { status: 403, headers });
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bitte wählen Sie eine gültige Benachrichtigungseinstellung.' }, { status: 400, headers });
  try {
    const saved = await prisma.school.update({
      where: { id: user.schoolId }, data: parsed.data,
      select: { reserveNotificationsEnabled: true },
    });
    return NextResponse.json(saved, { headers });
  } catch (error) {
    console.error('Could not save school reserve preference:', error);
    return NextResponse.json({ error: 'Die Einstellung konnte nicht gespeichert werden.' }, { status: 500, headers });
  }
}
