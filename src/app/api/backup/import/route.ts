import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const schulamtId = userSession.id;
    const body = await request.json();

    if (!body || !body.data || body.version !== '1.0') {
      return NextResponse.json({ error: 'Ungültiges Backup-Format' }, { status: 400 });
    }

    const {
      profile,
      users,
      schools,
      teachers,
      requests,
      assignments,
      absences
    } = body.data;

    // Führe den gesamten Import in einer Transaction durch
    await prisma.$transaction(async (tx) => {
      // 1. Alte Daten identifizieren
      const currentSchools = await tx.school.findMany({ where: { schulamtId } });
      const schoolIds = currentSchools.map(s => s.id);
      
      const currentTeachers = await tx.teacher.findMany({ where: { stammschuleId: { in: schoolIds } } });
      const teacherIds = currentTeachers.map(t => t.id);
      
      const currentRequests = await tx.request.findMany({ where: { schoolId: { in: schoolIds } } });
      const requestIds = currentRequests.map(r => r.id);

      const usersToDelete = await tx.user.findMany({
        where: {
          OR: [
            { schoolId: { in: schoolIds } },
            { teachers: { some: { id: { in: teacherIds } } } }
          ],
          role: { in: ['SCHOOL', 'TEACHER'] }
        }
      });
      const userIdsToDelete = usersToDelete.map(u => u.id);

      // 2. Alte Daten löschen (Reihenfolge ist wichtig wegen Fremdschlüsseln)
      if (requestIds.length > 0) {
        await tx.assignment.deleteMany({ where: { requestId: { in: requestIds } } });
      }
      if (teacherIds.length > 0) {
        await tx.absence.deleteMany({ where: { teacherId: { in: teacherIds } } });
      }
      if (schoolIds.length > 0) {
        await tx.request.deleteMany({ where: { schoolId: { in: schoolIds } } });
      }
      if (schoolIds.length > 0) {
        // Teacher referenziert User. Wir können Teacher gefahrlos löschen.
        await tx.teacher.deleteMany({ where: { stammschuleId: { in: schoolIds } } });
      }

      // Um Schulen zu löschen, müssen wir erst die Referenz der Users auf die Schulen lösen
      // oder die User direkt löschen (was wir sowieso vorhaben).
      // Wir setzen schoolId temporär auf null für alle betroffenen, falls es noch andere gibt.
      if (schoolIds.length > 0) {
        await tx.user.updateMany({
          where: { schoolId: { in: schoolIds } },
          data: { schoolId: null }
        });
        await tx.school.deleteMany({ where: { schulamtId } });
      }

      if (userIdsToDelete.length > 0) {
        await tx.user.deleteMany({ where: { id: { in: userIdsToDelete } } });
      }

      await tx.schulamtProfile.deleteMany({ where: { userId: schulamtId } });

      // 3. Neue Daten einfügen (Reihenfolge ist wichtig)
      
      // 3.1 Users
      if (users && users.length > 0) {
        // Filter out the SCHULAMT user itself if it happens to be in there (though it shouldn't, based on our export filter)
        const safeUsers = users.filter((u: any) => u.id !== schulamtId);
        if (safeUsers.length > 0) {
          // Temporär schoolId entfernen, um constraint fehler zu vermeiden, da Schulen noch nicht existieren
          const usersWithoutSchoolId = safeUsers.map((u: any) => ({ ...u, schoolId: null }));
          await tx.user.createMany({ data: usersWithoutSchoolId });
        }
      }

      // 3.2 Profil
      if (profile) {
        await tx.schulamtProfile.create({ data: { ...profile, userId: schulamtId } });
      }

      // 3.3 Schulen
      if (schools && schools.length > 0) {
        const mappedSchools = schools.map((s: any) => ({ ...s, schulamtId }));
        await tx.school.createMany({ data: mappedSchools });
        
        // Jetzt wo Schulen da sind, können wir die schoolIds bei den Usern wieder setzen
        for (const user of users) {
          if (user.schoolId && user.id !== schulamtId) {
            await tx.user.update({
              where: { id: user.id },
              data: { schoolId: user.schoolId }
            });
          }
        }
      }

      // 3.4 Lehrkräfte
      if (teachers && teachers.length > 0) {
        await tx.teacher.createMany({ data: teachers });
      }

      // 3.5 Anforderungen
      if (requests && requests.length > 0) {
        await tx.request.createMany({ data: requests });
      }

      // 3.6 Zuweisungen
      if (assignments && assignments.length > 0) {
        await tx.assignment.createMany({ data: assignments });
      }

      // 3.7 Fehlzeiten
      if (absences && absences.length > 0) {
        await tx.absence.createMany({ data: absences });
      }
    });

    return NextResponse.json({ message: 'Backup erfolgreich wiederhergestellt' }, { status: 200 });

  } catch (error) {
    console.error('Backup import failed:', error);
    return NextResponse.json({ error: 'Wiederherstellung fehlgeschlagen. Datei fehlerhaft oder Datenbank-Konflikt.' }, { status: 500 });
  }
}
