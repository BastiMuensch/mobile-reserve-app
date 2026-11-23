import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createDailyDeploymentWorkbook } from '@/lib/dailyDeploymentExport';
import { dailyDeployments, deploymentLifecycleFields } from '@/lib/dailyDeploymentList';
import { isValidDateKey, parseDateKeyStrict } from '@/lib/dateKey';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Bitte melden Sie sich erneut an.' }, { status: 401 });
  if (user.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Der Export ist nur für das Schulamt verfügbar.' }, { status: 403 });
  }

  const day = new URL(request.url).searchParams.get('date');
  if (!isValidDateKey(day)) return NextResponse.json({ error: 'Bitte wählen Sie einen gültigen Einsatztag.' }, { status: 400 });
  const date = parseDateKeyStrict(day);
  // Include legacy assignment timestamps on the Berlin date as well as canonical UTC dates.
  // dailyDeployments then checks the exact Berlin calendar day.
  const from = new Date(date.getTime() - 2 * 60 * 60_000);
  const until = new Date(date.getTime() + 24 * 60 * 60_000);
  const active = { in: ['PENDING', 'ACCEPTED'] };

  try {
    const requests = await prisma.request.findMany({
      where: {
        school: { schulamtId: user.id },
        status: { not: 'CANCELLED' },
        assignments: { some: { date: { gte: from, lt: until }, status: active } },
      },
      select: {
        school: { select: { name: true } },
        location: { select: { name: true } },
        substitutedTeacher: true,
        status: true,
        isOpenEnded: true,
        endDate: true,
        lifecycleEvents: { select: deploymentLifecycleFields, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        assignments: {
          where: { status: active },
          select: {
            id: true, teacherId: true, date: true, hours: true, status: true,
            teacher: { select: { name: true, stammschule: { select: { name: true } } } },
          },
        },
      },
    });
    const file = await createDailyDeploymentWorkbook(day, dailyDeployments(requests, [], day));
    return new NextResponse(Uint8Array.from(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="SVS-Tagesliste_${day}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Die Tagesliste konnte nicht exportiert werden.' }, { status: 500 });
  }
}
