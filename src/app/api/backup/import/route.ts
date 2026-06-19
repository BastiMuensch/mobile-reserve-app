import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getSessionUser } from '@/lib/auth';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

const importLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 3 });

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { success } = importLimiter.check(ip);
  if (!success) {
    return NextResponse.json(
      { error: 'Zu viele Import-Versuche. Bitte warten Sie 15 Minuten.' },
      { status: 429 }
    );
  }

  try {
    const schulamtId = userSession.id;

    // Prevent memory exhaustion from oversized payloads (max 50MB)
    const MAX_BACKUP_SIZE = 50 * 1024 * 1024;
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BACKUP_SIZE) {
      return NextResponse.json(
        { error: 'Backup-Datei ist zu groß. Maximal 50 MB erlaubt.' },
        { status: 413 }
      );
    }

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
        // Filter out the SCHULAMT user itself
        const nonSelfUsers = users.filter((u: Prisma.UserCreateInput) => u.id !== schulamtId);
        // SECURITY: Only allow importing SCHOOL and TEACHER roles to prevent privilege escalation
        const privilegedUsers = nonSelfUsers.filter((u: Prisma.UserCreateInput) => u.role === 'ADMIN' || u.role === 'SCHULAMT');
        if (privilegedUsers.length > 0) {
          console.warn(
            `[SECURITY] Backup import attempted to create ${privilegedUsers.length} privileged user(s) with roles: ${privilegedUsers.map((u: Prisma.UserCreateInput) => u.role).join(', ')}. These have been filtered out.`
          );
        }
        const safeUsers = nonSelfUsers.filter((u: Prisma.UserCreateInput) => u.role === 'SCHOOL' || u.role === 'TEACHER');
        if (safeUsers.length > 0) {
          // Temporär schoolId entfernen, um constraint fehler zu vermeiden, da Schulen noch nicht existieren
          const usersWithoutSchoolId = safeUsers.map((u: Prisma.UserCreateInput) => ({ ...u, schoolId: null }));
          await tx.user.createMany({ data: usersWithoutSchoolId });
        }
      }

      // 3.2 Profil
      if (profile) {
        await tx.schulamtProfile.create({ data: { ...profile, userId: schulamtId } });
      }

      // 3.3 Schulen
      if (schools && schools.length > 0) {
        const mappedSchools = schools.map((s: Prisma.SchoolCreateInput) => ({ ...s, schulamtId }));
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
