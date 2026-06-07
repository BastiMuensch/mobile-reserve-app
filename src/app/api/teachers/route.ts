export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
    const whereClause: any = userSession.role === 'SCHULAMT' ? { stammschule: { schulamtId: userSession.id } } : {};
    whereClause.schoolYear = year;

    const teachers = await prisma.teacher.findMany({
      where: whereClause,
      include: {
        stammschule: true,
        assignments: true,
      }
    });
    return NextResponse.json(teachers);
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
      password: z.string().optional().nullable(),
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
      const userEmail = validatedData.email || `${validatedData.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@lehrer.de`;
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
