import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

const resetLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 3 }); // 3 per hour

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { success } = resetLimiter.check(ip);
  if (!success) {
    return NextResponse.json(
      { error: 'Zu viele Reset-Versuche. Bitte warten Sie eine Stunde.' },
      { status: 429 }
    );
  }

  try {
    // A real app would archive these to a different table.
    // For this prototype, we'll delete the assignments, requests, and absences.
    const schools = await prisma.school.findMany({ where: { schulamtId: userSession.id }, select: { id: true } });
    const schoolIds = schools.map(s => s.id);

    const requests = await prisma.request.findMany({ where: { schoolId: { in: schoolIds } }, select: { id: true } });
    const requestIds = requests.map(r => r.id);

    const teachers = await prisma.teacher.findMany({ where: { stammschuleId: { in: schoolIds } }, select: { id: true } });
    const teacherIds = teachers.map(t => t.id);

    await prisma.$transaction([
      prisma.absence.deleteMany({ where: { teacherId: { in: teacherIds } } }),
      prisma.leavePeriod.deleteMany({ where: { teacherId: { in: teacherIds } } }),
      prisma.assignment.deleteMany({ where: { requestId: { in: requestIds } } }),
      prisma.request.deleteMany({ where: { schoolId: { in: schoolIds } } }),
      prisma.teacher.updateMany({
        where: { stammschuleId: { in: schoolIds } },
        data: { status: 'ACTIVE' }
      }),
    ]);

    return NextResponse.json({ success: true, message: "System reset successfully." });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to reset system' }, { status: 500 });
  }
}
