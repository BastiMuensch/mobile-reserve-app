import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import ExcelJS from 'exceljs';
import { getCurrentSchoolYear, getSchoolYearDates, schoolYearSchema } from '@/lib/schoolYear';
import { buildRequestYearOverlapFilter } from '@/lib/requestYearFilter';

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

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Anforderungen');
    const assignmentsSheet = workbook.addWorksheet('Einsätze');
    assignmentsSheet.columns = [
      { header: 'Datum', width: 14 }, { header: 'Schule', width: 35 }, { header: 'Lehrkraft', width: 30 },
      { header: 'Stunden', width: 12 }, { header: 'Status', width: 20 }, { header: 'Aktive Stunden (ohne Stornierungen)', width: 35 },
    ];
    const statusLabels: Record<string, string> = { REJECTED: 'Storniert', ACCEPTED: 'Bestätigt', PENDING: 'Bestätigung offen' };

    worksheet.columns = [
      { header: 'Datum', width: 12 },
      { header: 'Bis Datum', width: 12 },
      { header: 'Schule', width: 30 },
      { header: 'Schulart', width: 14 },
      { header: 'Bedarf pro Woche / Einzeltag', width: 28 },
      { header: 'Priorität', width: 14 },
      { header: 'Status', width: 16 },
      { header: 'Zu vertreten', width: 20 },
      { header: 'Kommentar', width: 30 },
      { header: 'Aktiv zugeteilte Lehrkräfte', width: 40 },
      { header: 'Aktive Einsatzdaten im Schuljahr', width: 40 },
    ];

    for (const req of requests) {
      const active = req.assignments.filter(a => a.status !== 'REJECTED');
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
        sanitizeCell([...new Set(active.map(a => a.teacher.name))].join(', ') || '–'),
        sanitizeCell(active.map(a => `${new Date(a.date).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}: ${a.hours}h`).join(', ') || '–'),
      ]);
      for (const assignment of req.assignments) assignmentsSheet.addRow([
        new Date(assignment.date).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }),
        sanitizeCell(req.school.name), sanitizeCell(assignment.teacher.name), assignment.hours,
        statusLabels[assignment.status] || assignment.status, assignment.status === 'REJECTED' ? 0 : assignment.hours,
      ]);
    }

    const buffer = await workbook.xlsx.writeBuffer();

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
