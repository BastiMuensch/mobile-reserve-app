export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { z } from 'zod';

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    let whereClause: Prisma.SchoolWhereInput = {};
    if (userSession.role === 'SCHULAMT') {
      whereClause = { schulamtId: userSession.id };
    } else if (userSession.role === 'SCHOOL' && userSession.school) {
      const school = await prisma.school.findUnique({ where: { id: userSession.school.id }, select: { schulamtId: true } });
      if (school?.schulamtId) whereClause = { schulamtId: school.schulamtId };
    } else if (userSession.role === 'TEACHER' && userSession.teachers && userSession.teachers.length > 0) {
      const schulamtIds = userSession.teachers
        .map(t => t.stammschule?.schulamtId)
        .filter((id): id is string => !!id);
      if (schulamtIds.length > 0) {
        whereClause = { schulamtId: { in: schulamtIds } };
      } else {
        whereClause = { id: 'none' };
      }
    } else if (userSession.role !== 'ADMIN') {
      whereClause = { id: 'none' };
    }
    const schools = await prisma.school.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        type: true,
        generalInfo: true,
        imageUrl: true,
        pinLat: true,
        pinLng: true,
        isSmall: true,
        outbreakUntil: true,
        outbreakDismissedUntil: true,
        user: userSession.role === 'SCHULAMT' ? {
          select: { id: true, email: true, role: true }
        } : false,
      }
    });
    return NextResponse.json(schools);
  } catch (error) {
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
      type: z.enum(['GRUNDSCHULE', 'MITTELSCHULE']),
      email: z.string().email('Ungültige E-Mail-Adresse').optional().nullable(),
      password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein'),
      latitude: z.number().optional().nullable(),
      longitude: z.number().optional().nullable(),
      // Vom Schulamt gesetzt, nicht automatisch aus einer Personalzahl abgeleitet - siehe urgency.ts.
      isSmall: z.boolean().optional(),
    });

    const parsedData = SchoolSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const validatedData = parsedData.data;
    
    let lat = validatedData.latitude || 48.0;
    let lng = validatedData.longitude || 10.5;

    if (validatedData.address && !validatedData.latitude) {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(validatedData.address)}`, {
          headers: { 'User-Agent': 'MobileReservenApp/1.0' }
        });
        const geo = await res.json();
        if (geo && geo.length > 0) {
          lat = parseFloat(geo[0].lat);
          lng = parseFloat(geo[0].lon);
        }
      } catch (e) {
        console.error("Geocoding failed for school:", e);
      }
    }

    const rawEmail = validatedData.email || `${validatedData.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@schule.de`;
    const email = rawEmail.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(validatedData.password, 10);

    const school = await prisma.school.create({
      data: {
        name: validatedData.name,
        address: validatedData.address,
        type: validatedData.type,
        latitude: lat,
        longitude: lng,
        isSmall: validatedData.isSmall ?? false,
        schulamtId: userSession.id,
        user: {
          create: {
            email: email,
            password: hashedPassword,
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

    return NextResponse.json(school, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to create school' }, { status: 500 });
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
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, error: `Ungültiges Datum für ${fieldLabel}.` };
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return { ok: false, error: `Ungültiges Datum für ${fieldLabel}.` };
  }
  parsed.setHours(23, 59, 59, 999);

  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + MAX_OVERRIDE_DATE_YEARS_AHEAD);
  if (parsed.getTime() > maxDate.getTime()) {
    return { ok: false, error: `${fieldLabel}: Das Datum darf höchstens ein Jahr in der Zukunft liegen.` };
  }

  return { ok: true, date: parsed };
}

export async function PATCH(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();

    if (data.action === 'updateInfo') {
      if (userSession.role !== 'SCHOOL' && userSession.role !== 'SCHULAMT') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const { schoolId, generalInfo, imageUrl, pinLat, pinLng } = data;
      if (userSession.role === 'SCHOOL' && userSession.schoolId !== schoolId) {
        return NextResponse.json({ error: 'Forbidden: You can only update your own school profile.' }, { status: 403 });
      }

      // Validate imageUrl: must start with /uploads/ or be empty/null
      if (imageUrl && !imageUrl.startsWith('/uploads/')) {
        return NextResponse.json({ error: 'Ungültige Bild-URL.' }, { status: 400 });
      }

      if (userSession.role === 'SCHULAMT') {
        const schoolCheck = await prisma.school.findUnique({ where: { id: schoolId } });
        if (!schoolCheck || schoolCheck.schulamtId !== userSession.id) {
          return NextResponse.json({ error: 'Forbidden: School does not belong to your Schulamt.' }, { status: 403 });
        }
      }
      const school = await prisma.school.update({
        where: { id: schoolId },
        data: {
          generalInfo,
          imageUrl: imageUrl || null,
          pinLat,
          pinLng
        }
      });
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

    if (!data.schoolId) {
      return NextResponse.json({ error: 'Missing schoolId' }, { status: 400 });
    }

    if (!data.newPassword && !data.newEmail) {
      return NextResponse.json({ error: 'Missing newPassword or newEmail' }, { status: 400 });
    }

    // Find the user for this school
    const user = await prisma.user.findUnique({
      where: { schoolId: data.schoolId }
    });

    if (!user) {
      return NextResponse.json({ error: 'User for this school not found' }, { status: 404 });
    }

    if (userSession.role !== 'SCHULAMT') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const schoolCheck = await prisma.school.findUnique({ where: { id: data.schoolId } });
    if (!schoolCheck || schoolCheck.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: School does not belong to your Schulamt.' }, { status: 403 });
    }

    const updateData: Prisma.UserUpdateInput = {};
    if (data.newPassword) {
      if (typeof data.newPassword !== 'string' || data.newPassword.length < 8) {
        return NextResponse.json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' }, { status: 400 });
      }
      updateData.password = await bcrypt.hash(data.newPassword, 10);
    }
    if (data.newEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.newEmail)) {
        return NextResponse.json({ error: 'Ungültige E-Mail-Adresse.' }, { status: 400 });
      }
      updateData.email = data.newEmail.trim().toLowerCase();
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: { id: true, email: true, role: true }
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
  }
}
