export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { getCurrentSchoolYear } from '@/lib/schoolYear';

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
    
    let lat = 48.01; // Fallback
    let lng = 10.5;  // Fallback
    
    if (data.address) {
      // Geocode using OpenStreetMap Nominatim
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(data.address)}`, {
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
    } else {
      lat = parseFloat(data.homeLat);
      lng = parseFloat(data.homeLng);
    }

    const teacher = await prisma.teacher.create({
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        stammschuleId: data.stammschuleId,
        maxWeeklyHours: parseInt(data.maxWeeklyHours),
        isPartTime: data.isPartTime || false,
        schedule: data.isPartTime && data.schedule ? JSON.stringify(data.schedule) : null,
        qualifications: data.qualifications,
        status: data.status || 'ACTIVE',
        homeLat: lat,
        homeLng: lng,
        preferredType: data.preferredType,
        schoolYear: data.schoolYear || getCurrentSchoolYear(),
      }
    });

    if (data.password) {
      const userEmail = data.email || `${data.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@lehrer.de`;
      const hashedPassword = await bcrypt.hash(data.password, 10);
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
