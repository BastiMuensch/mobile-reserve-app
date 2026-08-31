export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { getCurrentSchoolYear } from '@/lib/schoolYear';
import { z } from 'zod';

export async function GET(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  // Personen-, Adress-, Einsatz- und Abwesenheitsdaten sind ausschließlich für die
  // disponierende Stelle bestimmt. Schulen erhalten benötigte Lehrkraftdaten nur über
  // ihre eigenen Anforderungen, nicht als vollständiges Personalverzeichnis.
  if (userSession.role !== 'SCHULAMT' && userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') || getCurrentSchoolYear();

  try {
    let whereClause: Prisma.TeacherWhereInput = {};
    if (userSession.role === 'SCHULAMT') {
      whereClause = { stammschule: { schulamtId: userSession.id } };
    }
    whereClause.schoolYear = year;

    // Abwesenheiten von heute mitladen: Seit die Selbstmeldung einer Lehrkraft nicht mehr
    // dauerhaft `status` auf UNAVAILABLE setzt (sondern einen Absence-Datensatz schreibt),
    // braucht das Dashboard beide Quellen, um "Ungeplante Ausfälle" korrekt anzuzeigen.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const teachers = await prisma.teacher.findMany({
      where: whereClause,
      include: {
        stammschule: true,
        assignments: true,
        absences: {
          where: { date: { gte: todayStart, lte: todayEnd } },
          select: { id: true, date: true, type: true, reason: true },
        },
        // Laufende und künftige Langzeitabwesenheiten (Mutterschutz, Elternzeit, ...).
        // Abgelaufene Zeiträume interessieren die Planung nicht mehr.
        leavePeriods: {
          where: { OR: [{ endDate: null }, { endDate: { gte: todayStart } }] },
          orderBy: { startDate: 'asc' },
        },
      }
    });

    const teachersWithAbsenceFlag = teachers.map(teacher => ({
      ...teacher,
      isAbsentToday: teacher.absences.length > 0,
      // Läuft heute eine Langzeitabwesenheit? (endDate === null = bis auf Weiteres)
      currentLeave: teacher.leavePeriods.find(l =>
        l.startDate <= todayEnd && (!l.endDate || l.endDate >= todayStart)
      ) ?? null,
    }));

    return NextResponse.json(teachersWithAbsenceFlag);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch teachers' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();
    
    const TeacherSchema = z.object({
      name: z.string().min(1, 'Name ist erforderlich'),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      stammschuleId: z.string().uuid('Ungültige Schul-ID'),
      maxWeeklyHours: z.union([z.string(), z.number()]).transform(v => parseInt(v as string)),
      isPartTime: z.boolean().optional().default(false),
      schedule: z.any().optional().nullable(),
      qualifications: z.string(),
      status: z.string().optional().default('ACTIVE'),
      address: z.string().optional().nullable(),
      gender: z.enum(['FEMALE', 'MALE', 'DIVERSE']).optional().nullable(),
      homeLat: z.union([z.string(), z.number()]).transform(v => parseFloat(v as string)).optional(),
      homeLng: z.union([z.string(), z.number()]).transform(v => parseFloat(v as string)).optional(),
      preferredType: z.enum(['GRUNDSCHULE', 'MITTELSCHULE', 'BOTH']),
      schoolYear: z.string().optional().nullable(),
      password: z.string().min(12, 'Passwort muss mindestens 12 Zeichen lang sein').optional().nullable(),
    }).superRefine((value, ctx) => {
      if (value.password && !value.email) {
        ctx.addIssue({ code: 'custom', path: ['email'], message: 'Für einen Lehrkraft-Zugang ist eine E-Mail-Adresse erforderlich.' });
      }
    });

    const parsedData = TeacherSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const validatedData = parsedData.data;

    const stammschule = await prisma.school.findFirst({
      where: { id: validatedData.stammschuleId, schulamtId: userSession.id },
      select: { id: true },
    });
    if (!stammschule) {
      return NextResponse.json({ error: 'Die Stammschule gehört nicht zu diesem Schulamt.' }, { status: 403 });
    }

    if (!Number.isInteger(validatedData.maxWeeklyHours) || validatedData.maxWeeklyHours < 1 || validatedData.maxWeeklyHours > 60) {
      return NextResponse.json({ error: 'Die Wochenstunden müssen zwischen 1 und 60 liegen.' }, { status: 400 });
    }

    let lat: number;
    let lng: number;
    
    if (validatedData.address) {
      // Geocode using OpenStreetMap Nominatim
      let geo: unknown;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(validatedData.address)}`, {
          headers: { 'User-Agent': 'MobileReservenApp/1.0' },
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) throw new Error(`Geocoding ${res.status}`);
        geo = await res.json();
      } catch {
        return NextResponse.json({ error: 'Adresse konnte derzeit nicht überprüft werden.' }, { status: 503 });
      }
      if (Array.isArray(geo) && geo.length > 0 && geo[0]?.lat && geo[0]?.lon) {
        lat = Number(geo[0].lat);
        lng = Number(geo[0].lon);
      } else {
        return NextResponse.json({ error: 'Adresse konnte nicht gefunden werden.' }, { status: 400 });
      }
    } else if (validatedData.homeLat !== undefined && validatedData.homeLng !== undefined) {
      lat = validatedData.homeLat;
      lng = validatedData.homeLng;
    } else {
      return NextResponse.json({ error: 'Adresse oder vollständige Koordinaten sind erforderlich.' }, { status: 400 });
    }

    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return NextResponse.json({ error: 'Ungültige Koordinaten.' }, { status: 400 });
    }

    const hashedPassword = validatedData.password ? await bcrypt.hash(validatedData.password, 12) : null;
    const teacher = await prisma.$transaction(async tx => {
      const createdTeacher = await tx.teacher.create({ data: {
        name: validatedData.name,
        email: validatedData.email || null,
        phone: validatedData.phone || null,
        stammschuleId: validatedData.stammschuleId,
        maxWeeklyHours: validatedData.maxWeeklyHours,
        isPartTime: validatedData.isPartTime,
        schedule: validatedData.isPartTime && validatedData.schedule ? JSON.stringify(validatedData.schedule) : null,
        qualifications: validatedData.qualifications,
        status: validatedData.status,
        address: validatedData.address || '',
        gender: validatedData.gender || null,
        homeLat: lat,
        homeLng: lng,
        preferredType: validatedData.preferredType,
        schoolYear: validatedData.schoolYear || getCurrentSchoolYear(),
      }});

      if (hashedPassword && validatedData.email) {
        const newUser = await tx.user.create({
        data: {
          email: validatedData.email.trim().toLowerCase(),
          password: hashedPassword,
          role: 'TEACHER',
          name: validatedData.name,
        }
        });
        return tx.teacher.update({ where: { id: createdTeacher.id }, data: { userId: newUser.id } });
      }
      return createdTeacher;
    });

    return NextResponse.json(teacher, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create teacher' }, { status: 500 });
  }
}
