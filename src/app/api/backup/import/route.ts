import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { z } from 'zod';

const importLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 3 });

// Strukturvalidierung des Backups. Statt body.data blind zu destrukturieren,
// wird hier jede Sammlung auf die erwarteten Felder und Typen geprüft, bevor
// überhaupt an die Datenbank herangetreten wird.

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  password: z.string(),
  name: z.string().nullish(),
  role: z.string(),
  createdAt: z.coerce.date().optional(),
  schoolId: z.string().nullish(),
});

const SchoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  type: z.string(),
  generalInfo: z.string().nullish(),
  imageUrl: z.string().nullish(),
  pinLat: z.number().nullish(),
  pinLng: z.number().nullish(),
});

const TeacherSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  stammschuleId: z.string(),
  maxWeeklyHours: z.number(),
  isPartTime: z.boolean(),
  schedule: z.string().nullish(),
  qualifications: z.string(),
  status: z.string(),
  address: z.string(),
  gender: z.string().nullish(),
  homeLat: z.number(),
  homeLng: z.number(),
  preferredType: z.string(),
  schoolYear: z.string(),
  userId: z.string().nullish(),
});

const RequestSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  date: z.coerce.date(),
  endDate: z.coerce.date().nullish(),
  priority: z.string(),
  startHour: z.number(),
  hours: z.number(),
  weeklyHours: z.number(),
  schoolType: z.string(),
  substitutedTeacher: z.string(),
  schedule: z.string().nullish(),
  qualifications: z.string(),
  comments: z.string().nullish(),
  status: z.string(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

const AssignmentSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  teacherId: z.string(),
  date: z.coerce.date(),
  hours: z.number(),
  status: z.string(),
});

const AbsenceSchema = z.object({
  id: z.string(),
  teacherId: z.string(),
  date: z.coerce.date(),
  type: z.string(),
  reason: z.string().nullish(),
  createdAt: z.coerce.date().optional(),
});

// SMTP-Zugangsdaten sind bewusst NICHT Teil des Backups (siehe
// backup/export/route.ts), werden hier aber falls vorhanden toleriert und
// weiter unten verworfen, damit ältere Backups nicht an der Validierung scheitern.
const ProfileSchema = z.object({
  id: z.string().optional(),
  userId: z.string().optional(),
  headerText: z.string().optional(),
  returnAddress: z.string().optional(),
  logoUrl: z.string().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  contactAddress: z.string().optional(),
  contactPerson: z.string().optional(),
  city: z.string().optional(),
  amtsleitungName: z.string().optional(),
  amtsleitungTitle: z.string().optional(),
  signatureUrl: z.string().nullish(),
  smtpHost: z.string().nullish(),
  smtpUser: z.string().nullish(),
  smtpPass: z.string().nullish(),
  lastBackupDate: z.coerce.date().nullish(),
});

const BackupBodySchema = z.object({
  version: z.literal('1.0'),
  data: z.object({
    profile: ProfileSchema.nullish(),
    users: z.array(UserSchema).optional(),
    schools: z.array(SchoolSchema).optional(),
    teachers: z.array(TeacherSchema).optional(),
    requests: z.array(RequestSchema).optional(),
    assignments: z.array(AssignmentSchema).optional(),
    absences: z.array(AbsenceSchema).optional(),
  }),
});

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

    const parsedBody = BackupBodySchema.safeParse(body);
    if (!parsedBody.success) {
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
    } = parsedBody.data.data;

    // SECURITY: Fremdschlüssel dürfen nur auf Datensätze zeigen, die Teil
    // desselben Imports sind. Andernfalls könnte ein manipuliertes Backup
    // z. B. Lehrkräfte an Schulen FREMDER Schulämter hängen, indem eine
    // bestehende (fremde) stammschuleId referenziert wird. Diese Prüfung
    // läuft VOR der Transaction, damit im Fehlerfall noch nichts gelöscht wurde.
    const importedSchoolIds = new Set((schools ?? []).map(s => s.id));
    const importedTeacherIds = new Set((teachers ?? []).map(t => t.id));
    const importedRequestIds = new Set((requests ?? []).map(r => r.id));

    if ((teachers ?? []).some(t => !importedSchoolIds.has(t.stammschuleId))) {
      return NextResponse.json(
        { error: 'Ungültiges Backup: Eine Lehrkraft referenziert eine Schule, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

    if ((requests ?? []).some(r => !importedSchoolIds.has(r.schoolId))) {
      return NextResponse.json(
        { error: 'Ungültiges Backup: Eine Anforderung referenziert eine Schule, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

    if ((assignments ?? []).some(a => !importedRequestIds.has(a.requestId) || !importedTeacherIds.has(a.teacherId))) {
      return NextResponse.json(
        { error: 'Ungültiges Backup: Eine Zuweisung referenziert eine Anforderung oder Lehrkraft, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

    if ((absences ?? []).some(a => !importedTeacherIds.has(a.teacherId))) {
      return NextResponse.json(
        { error: 'Ungültiges Backup: Eine Fehlzeit referenziert eine Lehrkraft, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

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

      // Bestehende SMTP-Zugangsdaten sichern: Sie sind bewusst nicht Teil des
      // Backups (siehe backup/export/route.ts) und dürfen durch einen Import
      // nicht gelöscht/überschrieben werden.
      const existingProfile = await tx.schulamtProfile.findUnique({ where: { userId: schulamtId } });
      const preservedSmtp = {
        smtpHost: existingProfile?.smtpHost ?? null,
        smtpUser: existingProfile?.smtpUser ?? null,
        smtpPass: existingProfile?.smtpPass ?? null,
      };

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
        const nonSelfUsers = users.filter(u => u.id !== schulamtId);
        // SECURITY: Only allow importing SCHOOL and TEACHER roles to prevent privilege escalation
        const privilegedUsers = nonSelfUsers.filter(u => u.role === 'ADMIN' || u.role === 'SCHULAMT');
        if (privilegedUsers.length > 0) {
          console.warn(
            `[SECURITY] Backup import attempted to create ${privilegedUsers.length} privileged user(s) with roles: ${privilegedUsers.map(u => u.role).join(', ')}. These have been filtered out.`
          );
        }
        const safeUsers = nonSelfUsers.filter(u => u.role === 'SCHOOL' || u.role === 'TEACHER');
        if (safeUsers.length > 0) {
          // Temporär schoolId entfernen, um constraint fehler zu vermeiden, da Schulen noch nicht existieren
          const usersWithoutSchoolId = safeUsers.map(u => ({ ...u, schoolId: null }));
          await tx.user.createMany({ data: usersWithoutSchoolId });
        }
      }

      // 3.2 Profil
      // SMTP-Zugangsdaten kommen NICHT aus dem Backup, sondern werden aus der
      // bestehenden Datenbank übernommen (preservedSmtp), falls vorhanden.
      if (profile) {
        const { smtpHost: _oldHost, smtpUser: _oldUser, smtpPass: _oldPass, ...profileRest } = profile;
        await tx.schulamtProfile.create({
          data: { ...profileRest, ...preservedSmtp, userId: schulamtId }
        });
      } else if (existingProfile) {
        // Kein Profil im Backup, aber es gab zuvor eines: SMTP-Daten trotzdem erhalten.
        await tx.schulamtProfile.create({
          data: { ...preservedSmtp, userId: schulamtId }
        });
      }

      // 3.3 Schulen
      if (schools && schools.length > 0) {
        const mappedSchools = schools.map(s => ({ ...s, schulamtId }));
        await tx.school.createMany({ data: mappedSchools });

        // Jetzt wo Schulen da sind, können wir die schoolIds bei den Usern wieder setzen
        for (const user of users ?? []) {
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
