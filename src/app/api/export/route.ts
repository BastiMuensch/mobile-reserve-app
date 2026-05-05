import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const requests = await prisma.request.findMany({
      where: { school: { schulamtId: userSession.id } },
      include: {
        school: true,
        assignments: {
          include: { teacher: true }
        }
      },
      orderBy: { date: 'asc' }
    });

    let csvContent = "Request ID,Date,School Name,Grade,Hours,Status,Assigned Teachers,Teacher Stammschulen\n";
    
    requests.forEach(req => {
      const date = new Date(req.date).toLocaleDateString('de-DE');
      const teacherNames = req.assignments?.map(a => a.teacher.name).join(' | ') || '';
      const stammschulen = req.assignments?.map(a => a.teacher.stammschuleId).join(' | ') || '';
      
      const row = [
        req.id,
        date,
        `"${req.school.name}"`,
        req.grade,
        req.hours,
        req.status,
        `"${teacherNames}"`,
        `"${stammschulen}"`
      ];
      csvContent += row.join(",") + "\n";
    });

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="mobile_reserven_export.csv"',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}
