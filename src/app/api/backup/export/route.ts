import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const schulamtId = userSession.id;

    // 1. Profil abrufen
    const profile = await prisma.schulamtProfile.findUnique({
      where: { userId: schulamtId }
    });

    // 2. Schulen abrufen
    const schools = await prisma.school.findMany({
      where: { schulamtId: schulamtId }
    });
    const schoolIds = schools.map(s => s.id);

    // 3. Lehrkräfte abrufen
    const teachers = await prisma.teacher.findMany({
      where: { stammschuleId: { in: schoolIds } }
    });
    const teacherIds = teachers.map(t => t.id);

    // 4. Anforderungen abrufen
    const requests = await prisma.request.findMany({
      where: { schoolId: { in: schoolIds } }
    });
    const requestIds = requests.map(r => r.id);

    // 5. Zuweisungen abrufen
    const assignments = await prisma.assignment.findMany({
      where: { requestId: { in: requestIds } }
    });

    // 6. Fehlzeiten abrufen
    const absences = await prisma.absence.findMany({
      where: { teacherId: { in: teacherIds } }
    });

    // 7. Relevante Benutzer abrufen (Schulen und Lehrkräfte)
    // Wir holen alle User, die zu den Schulen gehören oder zu den Lehrkräften gehören.
    const usersRaw = await prisma.user.findMany({
      where: {
        OR: [
          { schoolId: { in: schoolIds } },
          { teachers: { some: { id: { in: teacherIds } } } }
        ]
      }
    });
    // Strip password hashes from backup data — imports generate new credentials anyway
    const users = usersRaw.map(({ password, ...rest }) => rest);

    // Wir speichern auch das Datum des Backups und eine Version
    const backupData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      schulamtId: schulamtId,
      data: {
        profile,
        users,
        schools,
        teachers,
        requests,
        assignments,
        absences
      }
    };

    return new NextResponse(JSON.stringify(backupData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="schulamt_backup_${new Date().toISOString().split('T')[0]}.json"`
      }
    });

  } catch (error) {
    console.error('Backup export failed:', error);
    return NextResponse.json({ error: 'Backup Export fehlgeschlagen', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
