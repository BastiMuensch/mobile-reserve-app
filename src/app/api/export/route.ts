import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import ExcelJS from 'exceljs';

/**
 * Verhindert Formel-Injection (CSV/Excel-Injection): Freitext aus der Datenbank
 * (Kommentare, Namen, "Zu vertreten" ...) könnte mit =, +, -, @, Tab oder CR
 * beginnen und würde von Excel/LibreOffice als Formel ausgeführt. Ein
 * vorangestelltes Hochkomma erzwingt die Interpretation als Text.
 */
function sanitizeCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

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

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Anforderungen');

    worksheet.columns = [
      { header: 'Datum', width: 12 },
      { header: 'Bis Datum', width: 12 },
      { header: 'Schule', width: 30 },
      { header: 'Schulart', width: 14 },
      { header: 'Stunden', width: 10 },
      { header: 'Priorität', width: 14 },
      { header: 'Status', width: 16 },
      { header: 'Zu vertreten', width: 20 },
      { header: 'Kommentar', width: 30 },
      { header: 'Zugeteilte Lehrkräfte', width: 40 },
      { header: 'Einsatzdaten', width: 40 },
    ];

    for (const req of requests) {
      worksheet.addRow([
        new Date(req.date).toLocaleDateString('de-DE'),
        req.endDate ? new Date(req.endDate).toLocaleDateString('de-DE') : '–',
        sanitizeCell(req.school.name),
        sanitizeCell(req.schoolType),
        req.weeklyHours || req.hours,
        sanitizeCell(req.priority),
        sanitizeCell(req.status),
        sanitizeCell(req.substitutedTeacher || '–'),
        sanitizeCell(req.comments || '–'),
        sanitizeCell(req.assignments.map(a => a.teacher.name).join(', ') || '–'),
        sanitizeCell(req.assignments.map(a => `${new Date(a.date).toLocaleDateString('de-DE')}: ${a.hours}h`).join(', ') || '–'),
      ]);
    }

    const buffer = await workbook.xlsx.writeBuffer();

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
