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
  
  // Privacy: Teachers can only see their own profile? Or maybe they don't even use this endpoint.
  // Actually, only SCHULAMT and SCHOOL need the full list.
  if (userSession.role === 'TEACHER') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year') || getCurrentSchoolYear();

  try {
    let whereClause: Prisma.TeacherWhereInput = {};
    if (userSession.role === 'SCHULAMT') {
      whereClause = { stammschule: { schulamtId: userSession.id } };
    } else if (userSession.role === 'SCHOOL' && userSession.school) {
      const school = await prisma.school.findUnique({ where: { id: userSession.school.id }, select: { schulamtId: true } });
      if (school?.schulamtId) {
        whereClause = { stammschule: { schulamtId: school.schulamtId } };
      } else {
        whereClause = { id: 'none' };
      }
    } else if (userSession.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein').optional().nullable(),
    });

    const parsedData = TeacherSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const validatedData = parsedData.data;

    let lat = 48.01; // Fallback
    let lng = 10.5;  // Fallback
    
    if (validatedData.address) {
      // Geocode using OpenStreetMap Nominatim
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(validatedData.address)}`, {
        headers: {
          'User-Agent': 'MobileReservenApp/1.0' // Required by Nominatim policy
        }
      });
      const geo = await res.json();
      if (geo && geo.length > 0) {
        lat = parseFloat(geo[0].lat);
        lng = parseFloat(geo[0].lon);
      } else {
        return NextResponse.json({ error: 'Adresse konnte nicht gefunden werden.' }, { status: 400 });
      }
    } else if (validatedData.homeLat !== undefined && validatedData.homeLng !== undefined) {
      lat = validatedData.homeLat;
      lng = validatedData.homeLng;
    }

    const teacher = await prisma.teacher.create({
      data: {
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
      }
    });

    if (validatedData.password) {
      const rawEmail = validatedData.email || `${validatedData.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@lehrer.de`;
      const userEmail = rawEmail.trim().toLowerCase();
      const hashedPassword = await bcrypt.hash(validatedData.password, 10);
      const newUser = await prisma.user.create({
        data: {
          email: userEmail,
          password: hashedPassword,
          role: 'TEACHER',
        }
      });
      await prisma.teacher.update({ where: { id: teacher.id }, data: { userId: newUser.id } });
    }

    return NextResponse.json(teacher, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create teacher' }, { status: 500 });
  }
}
