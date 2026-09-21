export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { z } from 'zod';
import { SCHOOL_TYPES } from '@/lib/schoolTypes';
import { geocodeAddress } from '@/lib/geocoding';
import { isValidDateKey, parseDateKeyStrict, toLocalDateInputValue } from '@/lib/dateKey';
import { mergeSchoolNavigationPoints, validateSchoolNavigationPoints } from '@/lib/schoolNavigation';

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    let whereClause: Prisma.SchoolWhereInput = {};
    if (userSession.role === 'SCHULAMT') {
      whereClause = { schulamtId: userSession.id };
    } else if (userSession.role === 'SCHOOL' && userSession.schoolId) {
      // A school account only needs its own complete profile. Returning its
      // peers' profile notes or arrival points here was unnecessary exposure.
      whereClause = { id: userSession.schoolId };
    } else if (userSession.role === 'TEACHER' && userSession.teachers && userSession.teachers.length > 0) {
      const schulamtIds = userSession.teachers
        .map(t => t.stammschule?.schulamtId)
        .filter((id): id is string => !!id);
      if (schulamtIds.length > 0) {
        whereClause = { schulamtId: { in: schulamtIds } };
      } else {
        whereClause = { id: 'none' };
      }
    } else {
      whereClause = { id: 'none' };
    }
    const fullProfile = userSession.role === 'SCHULAMT' || userSession.role === 'SCHOOL';
    const schools = await prisma.school.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        geocodingStatus: true,
        geocodingLastAttemptAt: true,
        geocodingError: true,
        type: true,
        // Teachers receive only the navigation directory. General instructions,
        // photos and legacy pins are available with the assigned request instead.
        ...(fullProfile ? {
          generalInfo: true,
          imageUrl: true,
          pinLat: true,
          pinLng: true,
          entranceLat: true,
          entranceLng: true,
          parkingLat: true,
          parkingLng: true,
          outbreakUntil: true,
          outbreakDismissedUntil: true,
        } : {}),
        isSmall: true,
        user: userSession.role === 'SCHULAMT' ? {
          select: { id: true, email: true, role: true }
        } : false,
      }
    });
    return NextResponse.json(schools);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch schools' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();
    
    const SchoolSchema = z.object({
      name: z.string().min(1, 'Schulname ist erforderlich'),
      address: z.string().min(1, 'Adresse ist erforderlich'),
      type: z.enum(SCHOOL_TYPES),
      email: z.string().trim().email('Ungültige E-Mail-Adresse'),
      password: z.string().min(12, 'Passwort muss mindestens 12 Zeichen lang sein').max(200)
        .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Passwort darf höchstens 72 UTF-8-Bytes lang sein.'),
      latitude: z.number().min(-90).max(90).optional().nullable(),
      longitude: z.number().min(-180).max(180).optional().nullable(),
      // Vom Schulamt gesetzt, nicht automatisch aus einer Personalzahl abgeleitet - siehe urgency.ts.
      isSmall: z.boolean().optional(),
    }).superRefine((school, ctx) => {
      if ((school.latitude == null) !== (school.longitude == null)) {
        ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Breiten- und Längengrad müssen gemeinsam angegeben werden.' });
      }
    });

    const parsedData = SchoolSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const validatedData = parsedData.data;
    
    let latitude = validatedData.latitude ?? null;
    let longitude = validatedData.longitude ?? null;
    let geocodingStatus = latitude != null && longitude != null ? 'MANUAL' : 'PENDING';
    let geocodingError: string | null = null;
    if (latitude == null || longitude == null) {
      const result = await geocodeAddress(validatedData.address);
      geocodingStatus = result.status;
      if (result.status === 'RESOLVED') {
        latitude = result.latitude;
        longitude = result.longitude;
      } else {
        geocodingError = result.error;
      }
    }

    const email = validatedData.email.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(validatedData.password, 12);

    const school = await prisma.school.create({
      data: {
        name: validatedData.name,
        address: validatedData.address,
        type: validatedData.type,
        latitude,
        longitude,
        geocodingStatus,
        geocodingLastAttemptAt: new Date(),
        geocodingError,
        isSmall: validatedData.isSmall ?? false,
        schulamtId: userSession.id,
        user: {
          create: {
            email: email,
            password: hashedPassword,
            mustChangePassword: true,
            role: 'SCHOOL'
          }
        }
      },
      include: { 
        user: {
          select: { id: true, email: true, role: true }
        } 
      }
    });

    return NextResponse.json({
      ...school,
      geocodingWarning: geocodingStatus === 'RESOLVED' || geocodingStatus === 'MANUAL'
        ? null
        : 'Die Schule wurde gespeichert. Der Standort konnte noch nicht ermittelt werden und wird später erneut geprüft.',
    }, { status: 201 });
  } catch (error) {
    console.error(error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Diese Login-E-Mail wird bereits verwendet.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create school' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = z.object({ schoolId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Ungültige Schul-ID.' }, { status: 400 });

  try {
    const result = await prisma.$transaction(async tx => {
      const school = await tx.school.findFirst({
        where: { id: parsed.data.schoolId, schulamtId: user.id },
        select: {
          id: true,
          user: { select: { id: true, role: true, _count: { select: { teachers: true } } } },
          _count: { select: { teachers: true, requests: true } },
        },
      });
      if (!school) return { error: 'Schule nicht gefunden.', status: 404 };
      if (school._count.teachers || school._count.requests) {
        return { error: 'Diese Schule hat bereits Lehrkräfte oder Bedarfe, auch aus früheren Schuljahren, und kann deshalb nicht gelöscht werden. Die Schulart können Sie weiterhin ändern.', status: 409 };
      }
      if (school.user && (school.user.role !== 'SCHOOL' || school.user._count.teachers)) {
        return { error: 'Der verknüpfte Zugang wird noch anderweitig verwendet. Die Schule kann nicht gelöscht werden.', status: 409 };
      }
      if (school.user) await tx.user.delete({ where: { id: school.user.id } });
      await tx.school.delete({ where: { id: school.id, schulamtId: user.id } });
      return { success: true, status: 200 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result.error ? { error: result.error } : { success: true }, { status: result.status });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2034', 'P2025'].includes(error.code)) {
      return NextResponse.json({ error: 'Die Schule wird inzwischen verwendet oder wurde geändert. Bitte laden Sie die Liste neu.' }, { status: 409 });
    }
    console.error('School deletion failed.');
    return NextResponse.json({ error: 'Die Schule konnte nicht gelöscht werden.' }, { status: 500 });
  }
}

// Ein Jahr in der Zukunft - eine Häufungs-Übersteuerung ist bewusst eine befristete
// Maßnahme (siehe urgency.ts), ein weiter reichendes Datum würde diese Befristung aushebeln.
const MAX_OVERRIDE_DATE_YEARS_AHEAD = 1;

/**
 * Validiert ein Override-Datum (outbreakUntil / outbreakDismissedUntil) und normalisiert es
 * auf das Ende des lokalen Tages, damit "gilt bis heute" den ganzen Tag mit einschließt
 * (konsistent mit toLocalDayStart in matching.ts, das den Tagesanfang auf dieselbe Weise
 * bildet). `null` löscht die Übersteuerung.
 */
function parseOverrideDate(
  value: unknown,
  fieldLabel: string
): { ok: true; date: Date | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, date: null };
  if (typeof value !== 'string' || !isValidDateKey(value)) {
    return { ok: false, error: `Ungültiges Datum für ${fieldLabel}.` };
  }
  const parsed = parseDateKeyStrict(value);
  parsed.setUTCHours(23, 59, 59, 999);

  const maxDate = parseDateKeyStrict(toLocalDateInputValue());
  maxDate.setUTCFullYear(maxDate.getUTCFullYear() + MAX_OVERRIDE_DATE_YEARS_AHEAD);
  maxDate.setUTCHours(23, 59, 59, 999);
  if (parsed.getTime() > maxDate.getTime()) {
    return { ok: false, error: `${fieldLabel}: Das Datum darf höchstens ein Jahr in der Zukunft liegen.` };
  }

  return { ok: true, date: parsed };
}

const SetCoordinatesSchema = z.object({
  schoolId: z.string().uuid('Ungültige Schul-ID.'),
  latitude: z.number().finite().min(-90, 'Breitengrad muss zwischen -90 und 90 liegen.').max(90, 'Breitengrad muss zwischen -90 und 90 liegen.'),
  longitude: z.number().finite().min(-180, 'Längengrad muss zwischen -180 und 180 liegen.').max(180, 'Längengrad muss zwischen -180 und 180 liegen.'),
});

const UpdateSchoolInfoSchema = z.object({
  schoolId: z.string().uuid('Ungültige Schul-ID.'),
  generalInfo: z.string().max(2000, 'Allgemeine Informationen dürfen höchstens 2000 Zeichen lang sein.').optional().nullable(),
  imageUrl: z.string().max(500).regex(/^\/uploads\/[a-zA-Z0-9._-]+$/, 'Ungültige Bild-URL.').optional().nullable(),
  entranceLat: z.number().finite().min(-90, 'Eingang-Breitengrad muss zwischen -90 und 90 liegen.').max(90, 'Eingang-Breitengrad muss zwischen -90 und 90 liegen.').optional().nullable(),
  entranceLng: z.number().finite().min(-180, 'Eingang-Längengrad muss zwischen -180 und 180 liegen.').max(180, 'Eingang-Längengrad muss zwischen -180 und 180 liegen.').optional().nullable(),
  parkingLat: z.number().finite().min(-90, 'Parkplatz-Breitengrad muss zwischen -90 und 90 liegen.').max(90, 'Parkplatz-Breitengrad muss zwischen -90 und 90 liegen.').optional().nullable(),
  parkingLng: z.number().finite().min(-180, 'Parkplatz-Längengrad muss zwischen -180 und 180 liegen.').max(180, 'Parkplatz-Längengrad muss zwischen -180 und 180 liegen.').optional().nullable(),
});

class SchoolProfileUpdateError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) {
    super(message);
  }
}

export async function PATCH(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();

    if (data.action === 'updateType') {
      if (userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const parsed = z.object({ schoolId: z.string().uuid(), type: z.enum(SCHOOL_TYPES) }).safeParse(data);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Ungültige Schule oder Schulart.' }, { status: 400 });
      }
      const result = await prisma.school.updateMany({
        where: { id: parsed.data.schoolId, schulamtId: userSession.id },
        data: { type: parsed.data.type },
      });
      if (!result.count) return NextResponse.json({ error: 'Schule nicht gefunden.' }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    if (data.action === 'retryGeocoding' || data.action === 'setCoordinates') {
      if (userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const school = await prisma.school.findFirst({ where: { id: data.schoolId, schulamtId: userSession.id } });
      if (!school) return NextResponse.json({ error: 'Schule nicht gefunden.' }, { status: 404 });

      if (data.action === 'setCoordinates') {
        const coordinates = SetCoordinatesSchema.safeParse(data);
        if (!coordinates.success) {
          return NextResponse.json({ error: coordinates.error.issues[0]?.message || 'Ungültige Koordinaten.' }, { status: 400 });
        }
        const updated = await prisma.school.update({
          where: { id: school.id },
          data: {
            latitude: coordinates.data.latitude,
            longitude: coordinates.data.longitude,
            geocodingStatus: 'MANUAL',
            geocodingLastAttemptAt: new Date(),
            geocodingError: null,
          },
        });
        return NextResponse.json({ success: true, school: updated });
      }

      const result = await geocodeAddress(school.address);
      const updated = await prisma.school.update({
        where: { id: school.id },
        data: result.status === 'RESOLVED'
          ? { latitude: result.latitude, longitude: result.longitude, geocodingStatus: 'RESOLVED', geocodingLastAttemptAt: new Date(), geocodingError: null }
          : { latitude: null, longitude: null, geocodingStatus: result.status, geocodingLastAttemptAt: new Date(), geocodingError: result.error },
      });
      return NextResponse.json({
        success: result.status === 'RESOLVED',
        school: updated,
        warning: result.status === 'RESOLVED' ? null : 'Der Standort konnte noch nicht ermittelt werden. Die Adresse bleibt gespeichert.',
      }, { status: result.status === 'UNAVAILABLE' ? 503 : result.status === 'NOT_FOUND' ? 422 : 200 });
    }

    if (data.action === 'updateInfo') {
      if (userSession.role !== 'SCHOOL' && userSession.role !== 'SCHULAMT') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      // Older clients sent an empty image string. Treat it as the explicit
      // no-image value while keeping omitted fields truly omitted.
      const parsedInfo = UpdateSchoolInfoSchema.safeParse({
        ...data,
        imageUrl: data.imageUrl === '' ? null : data.imageUrl,
      });
      if (!parsedInfo.success) {
        return NextResponse.json({ error: parsedInfo.error.issues[0]?.message || 'Ungültige Daten.' }, { status: 400 });
      }
      const { schoolId, generalInfo, imageUrl, entranceLat, entranceLng, parkingLat, parkingLng } = parsedInfo.data;
      if (userSession.role === 'SCHOOL' && userSession.schoolId !== schoolId) {
        return NextResponse.json({ error: 'Forbidden: You can only update your own school profile.' }, { status: 403 });
      }
      let school: Awaited<ReturnType<typeof prisma.school.update>> | null = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          school = await prisma.$transaction(async (tx) => {
            const schoolCheck = await tx.school.findUnique({
              where: { id: schoolId },
              select: { id: true, schulamtId: true, imageUrl: true, entranceLat: true, entranceLng: true, parkingLat: true, parkingLng: true },
            });
            if (!schoolCheck) throw new SchoolProfileUpdateError('Schule nicht gefunden.', 404);
            if (userSession.role === 'SCHOOL' && userSession.schoolId !== schoolCheck.id) {
              throw new SchoolProfileUpdateError('Forbidden: You can only update your own school profile.', 403);
            }
            if (userSession.role === 'SCHULAMT' && schoolCheck.schulamtId !== userSession.id) {
              throw new SchoolProfileUpdateError('Forbidden: School does not belong to your Schulamt.', 403);
            }

            const normalizedImageUrl = imageUrl === undefined ? undefined : (imageUrl || null);
            if (normalizedImageUrl && normalizedImageUrl !== schoolCheck.imageUrl) {
              const ownedSchoolImage = await tx.uploadedAsset.findFirst({
                where: { ownerUserId: userSession.id, url: normalizedImageUrl, purpose: 'school_image' },
                select: { id: true },
              });
              if (!ownedSchoolImage) {
                throw new SchoolProfileUpdateError('Das Schulbild wurde nicht von diesem Zugang für diesen Zweck hochgeladen.', 403);
              }
            }

            // Validate the final persisted state, never merely this partial patch.
            const navigation = mergeSchoolNavigationPoints({
              entranceLat: schoolCheck.entranceLat,
              entranceLng: schoolCheck.entranceLng,
              parkingLat: schoolCheck.parkingLat,
              parkingLng: schoolCheck.parkingLng,
            }, { entranceLat, entranceLng, parkingLat, parkingLng });
            const navigationError = validateSchoolNavigationPoints(navigation);
            if (navigationError) throw new SchoolProfileUpdateError(navigationError, 400);

            const updateData: Prisma.SchoolUpdateInput = { ...navigation };
            if (generalInfo !== undefined) updateData.generalInfo = generalInfo;
            if (normalizedImageUrl !== undefined) updateData.imageUrl = normalizedImageUrl;
            return tx.school.update({ where: { id: schoolId }, data: updateData });
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
          break;
        } catch (error) {
          if (error instanceof SchoolProfileUpdateError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
          }
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, attempt * 50));
            continue;
          }
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            return NextResponse.json({ error: 'Das Schulprofil wurde gleichzeitig geändert. Bitte neu laden und erneut speichern.' }, { status: 409 });
          }
          throw error;
        }
      }
      return NextResponse.json({ success: true, school });
    }

    if (data.action === 'updateFlags') {
      // Nur das Schulamt setzt "kleine Schule" (kennt seine Schulen) und die
      // Häufungs-Übersteuerungen - siehe urgency.ts.
      if (userSession.role !== 'SCHULAMT') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { schoolId, isSmall, outbreakUntil, outbreakDismissedUntil } = data;
      if (!schoolId || typeof schoolId !== 'string') {
        return NextResponse.json({ error: 'Missing schoolId' }, { status: 400 });
      }

      const schoolCheck = await prisma.school.findUnique({ where: { id: schoolId } });
      if (!schoolCheck) {
        return NextResponse.json({ error: 'Schule nicht gefunden.' }, { status: 404 });
      }
      if (schoolCheck.schulamtId !== userSession.id) {
        return NextResponse.json({ error: 'Forbidden: School does not belong to your Schulamt.' }, { status: 403 });
      }

      const updateData: Prisma.SchoolUpdateInput = {};

      if (isSmall !== undefined) {
        if (typeof isSmall !== 'boolean') {
          return NextResponse.json({ error: 'isSmall muss ein Boolean sein.' }, { status: 400 });
        }
        updateData.isSmall = isSmall;
      }

      if (outbreakUntil !== undefined) {
        const parsed = parseOverrideDate(outbreakUntil, 'Häufungs-Markierung');
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
        updateData.outbreakUntil = parsed.date;
      }

      if (outbreakDismissedUntil !== undefined) {
        const parsed = parseOverrideDate(outbreakDismissedUntil, 'Abwahl der Häufung');
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
        updateData.outbreakDismissedUntil = parsed.date;
      }

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: 'Keine Änderungen übergeben.' }, { status: 400 });
      }

      const school = await prisma.school.update({
        where: { id: schoolId },
        data: updateData
      });

      return NextResponse.json({ success: true, school });
    }

    if (userSession.role !== 'SCHULAMT') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!z.string().uuid().safeParse(data.schoolId).success) {
      return NextResponse.json({ error: 'Ungültige Schul-ID.' }, { status: 400 });
    }

    if (!data.newPassword && !data.newEmail) {
      return NextResponse.json({ error: 'Missing newPassword or newEmail' }, { status: 400 });
    }

    const schoolCheck = await prisma.school.findFirst({
      where: { id: data.schoolId, schulamtId: userSession.id },
      include: { user: true },
    });
    if (!schoolCheck) {
      return NextResponse.json({ error: 'Schule nicht gefunden.' }, { status: 404 });
    }
    const user = schoolCheck.user;
    if (!user || user.role !== 'SCHOOL') {
      return NextResponse.json({ error: 'Kein Schulzugang für diese Schule vorhanden.' }, { status: 404 });
    }

    const updateData: Prisma.UserUpdateInput = {};
    if (data.newPassword) {
      if (typeof data.newPassword !== 'string' || data.newPassword.length < 12 || Buffer.byteLength(data.newPassword, 'utf8') > 72) {
        return NextResponse.json({ error: 'Passwort muss mindestens 12 Zeichen und höchstens 72 UTF-8-Bytes lang sein.' }, { status: 400 });
      }
      updateData.password = await bcrypt.hash(data.newPassword, 12);
      updateData.isActive = true;
      updateData.mustChangePassword = true;
      updateData.sessionVersion = { increment: 1 };
    }
    if (data.newEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof data.newEmail !== 'string' || !emailRegex.test(data.newEmail)) {
        return NextResponse.json({ error: 'Ungültige E-Mail-Adresse.' }, { status: 400 });
      }
      updateData.email = data.newEmail.trim().toLowerCase();
    }

    const updatedUser = await prisma.$transaction(async tx => {
      const updated = await tx.user.update({
        where: { id: user.id, sessionVersion: user.sessionVersion, password: user.password, email: user.email, role: 'SCHOOL', schoolId: schoolCheck.id },
        data: updateData,
        select: { id: true, email: true, role: true },
      });
      if (data.newPassword) {
        await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      }
      return updated;
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Die Zugangsdaten wurden inzwischen geändert. Bitte laden Sie die Liste neu.' }, { status: 409 });
    }
    console.error('School update failed.');
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
  }
}
