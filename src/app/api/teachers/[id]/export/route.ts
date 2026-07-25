import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import ExcelJS from 'exceljs';

/**
 * Verhindert Formel-Injection (CSV/Excel-Injection): Freitext aus der Datenbank
 * könnte mit =, +, -, @, Tab oder CR beginnen und würde von Excel/LibreOffice
 * als Formel ausgeführt. Ein vorangestelltes Hochkomma erzwingt die
 * Interpretation als Text.
 */
function sanitizeCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Only SCHULAMT or the teacher themselves can view assignment history
  if (userSession.role === 'SCHOOL') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (userSession.role === 'TEACHER' && !userSession.teachers?.some((t: { id: string }) => t.id === id)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (userSession.role === 'SCHULAMT') {
    const teacherCheck = await prisma.teacher.findUnique({ where: { id: id }, include: { stammschule: true } });
    if (!teacherCheck || teacherCheck.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    const teacher = await prisma.teacher.findUnique({ where: { id: id } });
    if (!teacher) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const assignments = await prisma.assignment.findMany({
      where: { teacherId: id },
      include: {
        request: {
          include: {
            school: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });

    // Generate XLSX
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Einsätze');

    worksheet.columns = [
      { header: 'Datum', width: 12 },
      { header: 'Schule', width: 30 },
      { header: 'Fach/Klassen', width: 25 },
      { header: 'Einsatzstunden', width: 15 },
      { header: 'Status', width: 15 },
    ];

    for (const a of assignments) {
      worksheet.addRow([
        new Date(a.date).toLocaleDateString('de-DE'),
        sanitizeCell(a.request.school.name),
        sanitizeCell(a.request.qualifications),
        a.hours,
        sanitizeCell(a.status),
      ]);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `Einsaetze_${teacher.name.replace(/[^a-z0-9]/gi, '_')}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });

  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate export' }, { status: 500 });
  }
}
