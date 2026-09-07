import { prisma } from './prisma';
import { collectTenantAssets } from './backupAssets';

export async function generateBackupData(schulamtId: string) {
  // Keep related rows from one PostgreSQL snapshot, but deliberately collect
  // files afterwards so slow disk I/O never extends the database transaction.
  const snapshot = await prisma.$transaction(async (tx) => {
  const profile = await tx.schulamtProfile.findUnique({
    where: { userId: schulamtId }
  });

  // 2. Schulen abrufen
  const schools = await tx.school.findMany({
    where: { schulamtId: schulamtId }
  });
  const schoolIds = schools.map(s => s.id);

  // 3. Lehrkräfte abrufen
  const teachers = await tx.teacher.findMany({
    where: { stammschuleId: { in: schoolIds } }
  });
  const teacherIds = teachers.map(t => t.id);

  // 4. Anforderungen abrufen
  const requests = await tx.request.findMany({
    where: { schoolId: { in: schoolIds } }
  });
  const requestIds = requests.map(r => r.id);

  // 5. Zuweisungen abrufen
  const assignments = await tx.assignment.findMany({
    where: { requestId: { in: requestIds } }
  });

  // 6. Fehlzeiten abrufen
  const absences = await tx.absence.findMany({
    where: { teacherId: { in: teacherIds } }
  });

  // 6b. Längere Abwesenheiten abrufen (Mutterschutz, Elternzeit, ...)
  const leavePeriods = await tx.leavePeriod.findMany({
    where: { teacherId: { in: teacherIds } }
  });

  // 7. Relevante Benutzer abrufen (Schulen und Lehrkräfte)
  const usersRaw = await tx.user.findMany({
    where: {
      OR: [
        { schoolId: { in: schoolIds } },
        { teachers: { some: { id: { in: teacherIds } } } }
      ]
    }
  });

  const users = usersRaw.map(({ password, ...rest }) => {
    void password;
    return rest;
  });

  return { profile, users, schools, teachers, requests, assignments, absences, leavePeriods };
  }, { isolationLevel: 'RepeatableRead' });

  const assets = await collectTenantAssets({
    profileLogoUrl: snapshot.profile?.logoUrl,
    profileSignatureUrl: snapshot.profile?.signatureUrl,
    schoolImageUrls: snapshot.schools.map(s => s.imageUrl),
  });

  // Wir speichern das Datum des Backups und Version 2.0
  return {
    version: '2.0',
    timestamp: new Date().toISOString(),
    schulamtId: schulamtId,
    data: {
      ...snapshot,
      assets,
    }
  };
}
