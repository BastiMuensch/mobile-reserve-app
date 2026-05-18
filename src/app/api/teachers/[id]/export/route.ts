import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import * as XLSX from 'xlsx';

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

  if (userSession.role === 'TEACHER' && !userSession.teachers?.some((t: any) => t.id === id)) {
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
    const data = assignments.map(a => ({
      Datum: new Date(a.date).toLocaleDateString('de-DE'),
      Schule: a.request.school.name,
      'Fach/Klassen': a.request.qualifications,
      Einsatzstunden: a.hours,
      Status: a.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Einsätze');

    // Adjust column widths
    worksheet['!cols'] = [
      { wch: 12 }, // Datum
      { wch: 30 }, // Schule
      { wch: 25 }, // Fach/Klassen
      { wch: 15 }, // Einsatzstunden
      { wch: 15 }, // Status
    ];

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
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
