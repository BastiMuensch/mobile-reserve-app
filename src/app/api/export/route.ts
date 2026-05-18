import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import * as XLSX from 'xlsx';

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const requests = await prisma.request.findMany({
      where: { school: { schulamtId: userSession.id } },
      include: {
        school: { select: { name: true } },
        assignments: {
          include: { teacher: { select: { name: true } } },
        },
      },
      orderBy: { date: 'asc' },
    });

    const data = requests.map(req => ({
      Datum: new Date(req.date).toLocaleDateString('de-DE'),
      Schule: req.school.name,
      Schulart: req.schoolType,
      Stunden: req.weeklyHours || req.hours,
      Priorität: req.priority,
      Status: req.status,
      'Zugeteilte Lehrkräfte': req.assignments.map(a => a.teacher.name).join(', ') || '–',
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Anforderungen');

    worksheet['!cols'] = [
      { wch: 12 }, // Datum
      { wch: 30 }, // Schule
      { wch: 14 }, // Schulart
      { wch: 10 }, // Stunden
      { wch: 14 }, // Priorität
      { wch: 16 }, // Status
      { wch: 40 }, // Lehrkräfte
    ];

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="mobile_reserven_export.xlsx"',
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}
