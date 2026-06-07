import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await request.json();
    const { sourceYear, targetYear } = data;

    if (!sourceYear || !targetYear) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Get all teachers from source year belonging to this Schulamt's schools
    const sourceTeachers = await prisma.teacher.findMany({
      where: {
        schoolYear: sourceYear,
        stammschule: {
          schulamtId: userSession.id
        }
      }
    });

    if (sourceTeachers.length === 0) {
      return NextResponse.json({ error: `Keine Lehrkräfte im Quell-Schuljahr (${sourceYear}) gefunden.` }, { status: 400 });
    }

    // Check if target year already has teachers (to avoid duplicate copying)
    const existingTargetTeachers = await prisma.teacher.count({
      where: {
        schoolYear: targetYear,
        stammschule: {
          schulamtId: userSession.id
        }
      }
    });

    if (existingTargetTeachers > 0) {
      return NextResponse.json({ error: `Das Schuljahr ${targetYear} enthält bereits Lehrkräfte. Das Kopieren ist nur für ein leeres Schuljahr möglich.` }, { status: 400 });
    }

    // Copy teachers
    const newTeachers = sourceTeachers.map(t => ({
      name: t.name,
      email: t.email,
      phone: t.phone,
      stammschuleId: t.stammschuleId,
      maxWeeklyHours: t.maxWeeklyHours,
      isPartTime: t.isPartTime,
      schedule: t.schedule,
      qualifications: t.qualifications,
      status: t.status,
      address: t.address,
      gender: t.gender,
      homeLat: t.homeLat,
      homeLng: t.homeLng,
      preferredType: t.preferredType,
      schoolYear: targetYear,
      userId: t.userId
    }));

    await prisma.teacher.createMany({
      data: newTeachers
    });

    return NextResponse.json({ success: true, copied: newTeachers.length });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Kopieren der Lehrkräfte' }, { status: 500 });
  }
}
