import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { getCurrentSchoolYear, getSchoolYearDates, schoolYearSchema } from '@/lib/schoolYear';
import { buildRequestYearOverlapFilter } from '@/lib/requestYearFilter';
import { createYearExportWorkbook } from '@/lib/yearExport';

export async function GET(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const selectedYear = schoolYearSchema.safeParse(new URL(request.url).searchParams.get('year') || getCurrentSchoolYear());
  if (!selectedYear.success) return NextResponse.json({ error: 'Ungültiges Schuljahr.' }, { status: 400 });
  const { start, end } = getSchoolYearDates(selectedYear.data);

  try {
    const requests = await prisma.request.findMany({
      where: { school: { schulamtId: userSession.id }, ...buildRequestYearOverlapFilter(start, end) },
      include: {
        school: { select: { name: true } },
        assignments: {
          where: { date: { gte: start, lte: end } },
          orderBy: { date: 'asc' },
          include: { teacher: { select: { name: true } } },
        },
      },
      orderBy: { date: 'asc' },
    });

    const buffer = new Uint8Array(await createYearExportWorkbook({ requests }));

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="mobile_reserven_${selectedYear.data.replace('/', '-')}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}
