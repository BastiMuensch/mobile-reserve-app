import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import { BAYTGV_LEGAL_TEXT } from '@/lib/onboarding';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import {
  getPrivateUploadsDir,
  getPublicUploadsDir,
  MAX_BACKUP_JSON_SIZE,
  validateAssetReferences,
  validateLegacyAssetReferences,
  validateAndWriteImportAssets,
  cleanupWrittenFiles,
} from '@/lib/backupAssets';
import { validateSchoolNavigationPoints } from '@/lib/schoolNavigation';
import { isLocalLoginLogoUrl, PUBLIC_INSTANCE_SETTING_IDS } from '@/lib/publicInstanceSettings';

const importLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 3 });

class BackupBodyTooLargeError extends Error {}

/**
 * Route Handlers expose a Web ReadableStream. Reading it ourselves makes the
 * actual byte limit enforceable even when Content-Length is omitted or forged;
 * JSON still needs one bounded in-memory buffer for schema validation.
 */
async function readBackupJson(request: Request): Promise<unknown> {
  const declaredSize = request.headers.get('content-length');
  if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_BACKUP_JSON_SIZE)) {
    throw new BackupBodyTooLargeError();
  }
  if (!request.body) throw new Error('Leerer Request-Body.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BACKUP_JSON_SIZE) {
        await reader.cancel('Backup request exceeds size limit');
        throw new BackupBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

// Strukturvalidierung des Backups. Statt body.data blind zu destrukturieren,
// wird hier jede Sammlung auf die erwarteten Felder und Typen geprüft, bevor
// überhaupt an die Datenbank herangetreten wird.

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  password: z.string().optional(),
  name: z.string().nullish(),
  role: z.string(),
  createdAt: z.coerce.date().optional(),
  schoolId: z.string().nullish(),
});

const SchoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  geocodingStatus: z.enum(['PENDING', 'RESOLVED', 'NOT_FOUND', 'UNAVAILABLE', 'MANUAL']).optional(),
  geocodingLastAttemptAt: z.coerce.date().nullish(),
  geocodingError: z.string().nullish(),
  type: z.string(),
  generalInfo: z.string().nullish(),
  imageUrl: z.string().nullish(),
  pinLat: z.number().nullish(),
  pinLng: z.number().nullish(),
  // v1/v2 files created before explicit arrival points have no such meaning;
  // defaulting to null preserves their legacy pin without reclassifying it.
  entranceLat: z.number().finite().min(-90).max(90).nullish().default(null),
  entranceLng: z.number().finite().min(-180).max(180).nullish().default(null),
  parkingLat: z.number().finite().min(-90).max(90).nullish().default(null),
  parkingLng: z.number().finite().min(-180).max(180).nullish().default(null),
  isSmall: z.boolean().optional().default(false),
  outbreakUntil: z.coerce.date().nullish(),
  outbreakDismissedUntil: z.coerce.date().nullish(),
}).superRefine((school, ctx) => {
  const error = validateSchoolNavigationPoints(school);
  if (error) ctx.addIssue({ code: 'custom', path: [error.startsWith('Eingang') ? 'entranceLat' : 'parkingLat'], message: error });
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
  // Backups vor Einführung der getrennten Geocoding-PLZ bleiben importierbar.
  // Ihre vorhandenen Koordinaten werden beibehalten; die PLZ kann danach ergänzt werden.
  postalCode: z.string().regex(/^\d{5}$/).optional().default(''),
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
  isOpenEnded: z.boolean().optional().default(false),
  endedAt: z.coerce.date().nullish(),
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
  unfilledReason: z.string().nullish(),
  unfilledAt: z.coerce.date().nullish(),
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

const LeavePeriodSchema = z.object({
  id: z.string(),
  teacherId: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish(),
  reportedBy: z.string(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
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
  documentSubject: z.string().optional(),
  documentIntro: z.string().optional(),
  documentLegalText: z.string().optional(),
  documentClosing: z.string().optional(),
  mailProvider: z.enum(['NONE', 'SMTP']).optional(),
  smtpHost: z.string().nullish(),
  smtpPort: z.number().int().nullish(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().nullish(),
  smtpPass: z.string().nullish(),
  smtpFromName: z.string().nullish(),
  smtpFromAddress: z.string().nullish(),
  teacherInviteValidityDays: z.number().int().min(1).max(90).optional(),
  lastBackupDate: z.coerce.date().nullish(),
});

const AssetSchema = z.object({
  originalUrl: z.string(),
  mimeType: z.string(),
  sha256: z.string(),
  dataBase64: z.string(),
  purpose: z.enum(['logo', 'signature', 'school-image']),
});

// Backup settings intentionally allow an empty legacy instance name. The live
// settings form requires a name, but importing a pre-settings backup must not
// fail or invent one. This remains the same narrow, public-only whitelist.
const BackupPublicInstanceSettingsSchema = z.object({
  publicInstanceName: z.string().trim().max(200),
  publicSupportContact: z.string().trim().max(1000),
  impressum: z.string().trim().max(12_000),
  privacyPolicy: z.string().trim().max(12_000),
  loginLogoUrl: z.string().trim().refine((value) => !value || isLocalLoginLogoUrl(value), 'Ungültiges Login-Logo.'),
  loginLogoAlt: z.string().trim().max(200),
}).strict();

const BackupBodySchema = z.object({
  version: z.enum(['1.0', '2.0']),
  data: z.object({
    profile: ProfileSchema.nullish(),
    // Optional for every pre-settings v1/v2 backup. When absent, current local
    // public branding/legal settings remain untouched.
    publicInstanceSettings: BackupPublicInstanceSettingsSchema.optional(),
    users: z.array(UserSchema).optional(),
    schools: z.array(SchoolSchema).optional(),
    teachers: z.array(TeacherSchema).optional(),
    requests: z.array(RequestSchema).optional(),
    assignments: z.array(AssignmentSchema).optional(),
    absences: z.array(AbsenceSchema).optional(),
    leavePeriods: z.array(LeavePeriodSchema).optional(),
    assets: z.array(AssetSchema).optional(),
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

    let body: unknown;
    try {
      body = await readBackupJson(request);
    } catch (error) {
      if (error instanceof BackupBodyTooLargeError) {
        return NextResponse.json({ error: 'Backup-Datei ist zu groß. Maximal 50 MB erlaubt.' }, { status: 413 });
      }
      return NextResponse.json({ error: 'Backup-Datei ist nicht als gültiges JSON lesbar.' }, { status: 400 });
    }

    const parsedBody = BackupBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Ungültiges Backup-Format' }, { status: 400 });
    }

    const {
      profile,
      publicInstanceSettings,
      users,
      schools,
      teachers,
      requests,
      assignments,
      absences,
      leavePeriods,
      assets,
    } = parsedBody.data.data;

    let urlMapping = new Map<string, string>();
    let writtenFiles: string[] = [];
    let legacySignatureWarning: string | null = null;

    // A v2 backup is all-or-nothing: every referenced asset must be present,
    // uniquely bound to its purpose, and pass validation before any file write.
    if (parsedBody.data.version === '2.0') {
      try {
        validateAssetReferences({
          profileLogoUrl: profile?.logoUrl,
          publicInstanceLoginLogoUrl: publicInstanceSettings?.loginLogoUrl,
          profileSignatureUrl: profile?.signatureUrl,
          schoolImageUrls: schools?.map((school) => school.imageUrl),
        }, assets ?? []);
      } catch (assetErr) {
        return NextResponse.json({ error: assetErr instanceof Error ? assetErr.message : 'Fehler bei der Asset-Validierung.' }, { status: 400 });
      }
    } else {
      try {
        validateLegacyAssetReferences({
          profileLogoUrl: profile?.logoUrl,
          publicInstanceLoginLogoUrl: publicInstanceSettings?.loginLogoUrl,
          profileSignatureUrl: profile?.signatureUrl,
          schoolImageUrls: schools?.map((school) => school.imageUrl),
        });
      } catch (assetErr) {
        return NextResponse.json({ error: assetErr instanceof Error ? assetErr.message : 'Ungültige Asset-Referenz im Backup.' }, { status: 400 });
      }
    }

    // SECURITY: Fremdschlüssel dürfen nur auf Datensätze zeigen, die Teil
    // desselben Imports sind. Andernfalls könnte ein manipuliertes Backup
    // z. B. Lehrkräfte an Schulen FREMDER Schulämter hängen, indem eine
    // bestehende (fremde) stammschuleId referenziert wird. Diese Prüfung
    // läuft VOR der Transaction, damit im Fehlerfall noch nichts gelöscht wurde.
    const importedSchoolIds = new Set((schools ?? []).map(s => s.id));
    const importedTeacherIds = new Set((teachers ?? []).map(t => t.id));
    const importedRequestIds = new Set((requests ?? []).map(r => r.id));
    const safeImportedUsers = (users ?? []).filter(user =>
      user.id !== userSession.id && (user.role === 'SCHOOL' || user.role === 'TEACHER')
    );
    const importedTeacherUserIds = new Set(safeImportedUsers.filter(user => user.role === 'TEACHER').map(user => user.id));

    if ((users ?? []).some(user => user.schoolId && !importedSchoolIds.has(user.schoolId))) {
      await cleanupWrittenFiles(writtenFiles);
      return NextResponse.json(
        { error: 'Ungültiges Backup: Ein Schulzugang referenziert eine Schule, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

    if ((teachers ?? []).some(t => !importedSchoolIds.has(t.stammschuleId))) {
      await cleanupWrittenFiles(writtenFiles);
      return NextResponse.json(
        { error: 'Ungültiges Backup: Eine Lehrkraft referenziert eine Schule, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

    if ((teachers ?? []).some(t => t.userId && !importedTeacherUserIds.has(t.userId))) {
      await cleanupWrittenFiles(writtenFiles);
      return NextResponse.json(
        { error: 'Ungültiges Backup: Ein Lehrkraft-Datensatz referenziert keinen importierten Lehrkraft-Zugang.' },
        { status: 400 }
      );
    }

    if ((requests ?? []).some(r => !importedSchoolIds.has(r.schoolId))) {
      await cleanupWrittenFiles(writtenFiles);
      return NextResponse.json(
        { error: 'Ungültiges Backup: Eine Anforderung referenziert eine Schule, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

    if ((assignments ?? []).some(a => !importedRequestIds.has(a.requestId) || !importedTeacherIds.has(a.teacherId))) {
      await cleanupWrittenFiles(writtenFiles);
      return NextResponse.json(
        { error: 'Ungültiges Backup: Eine Zuweisung referenziert eine Anforderung oder Lehrkraft, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

    if ((absences ?? []).some(a => !importedTeacherIds.has(a.teacherId))) {
      await cleanupWrittenFiles(writtenFiles);
      return NextResponse.json(
        { error: 'Ungültiges Backup: Eine Fehlzeit referenziert eine Lehrkraft, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

    if ((leavePeriods ?? []).some(l => !importedTeacherIds.has(l.teacherId))) {
      await cleanupWrittenFiles(writtenFiles);
      return NextResponse.json(
        { error: 'Ungültiges Backup: Eine längere Abwesenheit referenziert eine Lehrkraft, die nicht Teil des Backups ist.' },
        { status: 400 }
      );
    }

    // Files are deliberately written only after *all* structural and relation
    // checks above. A rejected backup must not leave usable media behind.
    if (assets && assets.length > 0) {
      try {
        const assetResult = await validateAndWriteImportAssets(assets);
        urlMapping = assetResult.urlMapping;
        writtenFiles = assetResult.writtenFiles;
      } catch (assetErr) {
        return NextResponse.json({
          error: assetErr instanceof Error ? assetErr.message : 'Fehler bei der Asset-Validierung.',
        }, { status: 400 });
      }
    } else if (parsedBody.data.version === '1.0' && profile?.signatureUrl?.startsWith('/uploads/')) {
      // Legacy v1.0 has no embedded assets. Preserve compatibility, but never
      // silently claim a missing legacy signature was restored.
      const filename = path.basename(profile.signatureUrl);
      const publicFile = path.join(getPublicUploadsDir(), filename);
      const privateDir = getPrivateUploadsDir();
      await mkdir(privateDir, { recursive: true });
      const privateFile = path.join(privateDir, filename);
      try {
        const data = await readFile(publicFile);
        await writeFile(privateFile, data, { flag: 'wx' });
        writtenFiles.push(privateFile);
        profile.signatureUrl = `/api/media/${filename}`;
      } catch {
        legacySignatureWarning = 'Die im Backup v1.0 referenzierte Unterschrift konnte nicht wiederhergestellt werden.';
        profile.signatureUrl = null;
      }
    }

    // URLs are remapped only from prevalidated v2 assets. No profile or school
    // field can point to an unverified path provided by the import file.
    if (profile?.logoUrl) profile.logoUrl = urlMapping.get(profile.logoUrl) ?? profile.logoUrl;
    if (profile?.signatureUrl) profile.signatureUrl = urlMapping.get(profile.signatureUrl) ?? profile.signatureUrl;
    if (publicInstanceSettings?.loginLogoUrl) publicInstanceSettings.loginLogoUrl = urlMapping.get(publicInstanceSettings.loginLogoUrl) ?? publicInstanceSettings.loginLogoUrl;
    for (const school of schools ?? []) {
      if (school.imageUrl) school.imageUrl = urlMapping.get(school.imageUrl) ?? school.imageUrl;
    }

    // Filesystem data alone cannot prove ownership after the import. Recreate
    // the metadata used by the private-media authorization and orphan cleanup
    // in the same transaction as the restored profile/schools.
    const restoredAssets = (assets ?? []).flatMap((asset) => {
      const url = urlMapping.get(asset.originalUrl);
      if (!url) return [];
      let ownerUserId = schulamtId;
      if (asset.purpose === 'school-image') {
        const school = (schools ?? []).find((candidate) => candidate.imageUrl === url);
        const schoolOwner = school
          ? safeImportedUsers.find((user) => user.role === 'SCHOOL' && user.schoolId === school.id)
          : undefined;
        ownerUserId = schoolOwner?.id ?? schulamtId;
      }
      return [{
        ownerUserId,
        url,
        purpose: asset.purpose === 'school-image' ? 'school_image' : asset.purpose,
      }];
    });

    // Exportdateien enthalten bewusst keine Passwort-Hashes. Importierte Konten erhalten
    // deshalb ein unbekanntes Zufallspasswort und müssen anschließend zurückgesetzt werden.
    const importedPasswordHash = await bcrypt.hash(randomUUID(), 12);

    try {
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
        mailProvider: existingProfile?.mailProvider ?? 'NONE',
        smtpHost: existingProfile?.smtpHost ?? null,
        smtpPort: existingProfile?.smtpPort ?? null,
        smtpSecure: existingProfile?.smtpSecure ?? false,
        smtpUser: existingProfile?.smtpUser ?? null,
        smtpPass: existingProfile?.smtpPass ?? null,
        smtpFromName: existingProfile?.smtpFromName ?? null,
        smtpFromAddress: existingProfile?.smtpFromAddress ?? null,
      };

      // 2. Alte Daten löschen (Reihenfolge ist wichtig wegen Fremdschlüsseln)
      if (requestIds.length > 0) {
        await tx.assignment.deleteMany({ where: { requestId: { in: requestIds } } });
      }
      if (teacherIds.length > 0) {
        await tx.absence.deleteMany({ where: { teacherId: { in: teacherIds } } });
        await tx.leavePeriod.deleteMany({ where: { teacherId: { in: teacherIds } } });
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
        const privilegedUsers = nonSelfUsers.filter(u => u.role !== 'SCHOOL' && u.role !== 'TEACHER');
        if (privilegedUsers.length > 0) {
          console.warn(
            `[SECURITY] Backup import attempted to create ${privilegedUsers.length} privileged user(s) with roles: ${privilegedUsers.map(u => u.role).join(', ')}. These have been filtered out.`
          );
        }
        const safeUsers = safeImportedUsers;
        if (safeUsers.length > 0) {
          // Importierte Konten werden bis zur Passwort-Neuvergabe deaktiviert. Die zufällige
          // Session-Version verhindert außerdem, dass ein vor dem Import ausgestelltes JWT
          // bei wiederverwendeter User-ID zufällig weiter gilt.
          const usersWithoutSchoolId = safeUsers.map(u => ({
            ...u,
            password: importedPasswordHash,
            schoolId: null,
            isActive: false,
            sessionVersion: randomInt(1, 2_000_000_000),
          }));
          await tx.user.createMany({ data: usersWithoutSchoolId });
        }
      }

      // 3.2 Profil
      // SMTP-Zugangsdaten kommen NICHT aus dem Backup, sondern werden aus der
      // bestehenden Datenbank übernommen (preservedSmtp), falls vorhanden.
      if (profile) {
        const {
          mailProvider: _oldProvider,
          smtpHost: _oldHost, smtpPort: _oldPort, smtpSecure: _oldSecure,
          smtpUser: _oldUser, smtpPass: _oldPass,
          smtpFromName: _oldFromName, smtpFromAddress: _oldFromAddress,
          ...profileRest
        } = profile;
        void [_oldProvider, _oldHost, _oldPort, _oldSecure, _oldUser, _oldPass, _oldFromName, _oldFromAddress];
        await tx.schulamtProfile.create({
          data: { ...profileRest, documentLegalText: BAYTGV_LEGAL_TEXT, ...preservedSmtp, userId: schulamtId }
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
        for (const user of safeImportedUsers.filter(importedUser => importedUser.role === 'SCHOOL')) {
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

      // 3.8 Längere Abwesenheiten
      if (leavePeriods && leavePeriods.length > 0) {
        await tx.leavePeriod.createMany({ data: leavePeriods });
      }

      if (restoredAssets.length > 0) {
        await tx.uploadedAsset.createMany({ data: restoredAssets });
      }

      // Old backups do not carry these global-but-public values. Preserve the
      // installation values in that case; a new backup may override exactly the
      // validated whitelist, never SMTP/VAPID or other system settings.
      if (publicInstanceSettings) {
        for (const id of PUBLIC_INSTANCE_SETTING_IDS) {
          await tx.systemSetting.upsert({
            where: { id },
            create: { id, value: publicInstanceSettings[id] },
            update: { value: publicInstanceSettings[id] },
          });
        }
      }
    });
    } catch (txErr) {
      await cleanupWrittenFiles(writtenFiles);
      throw txErr;
    }

    return NextResponse.json({
      message: 'Backup erfolgreich wiederhergestellt. Importierte Schul- und Lehrkraftkonten benötigen neue Passwörter.',
      warning: legacySignatureWarning ?? undefined,
    }, { status: 200 });

  } catch (error) {
    console.error('Backup import failed:', error);
    return NextResponse.json({ error: 'Wiederherstellung fehlgeschlagen. Datei fehlerhaft oder Datenbank-Konflikt.' }, { status: 500 });
  }
}
