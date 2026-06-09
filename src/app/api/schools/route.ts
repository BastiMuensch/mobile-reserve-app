export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { z } from 'zod';

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const whereClause = userSession.role === 'SCHULAMT' ? { schulamtId: userSession.id } : {};
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
      password: z.string().min(6, 'Passwort muss mindestens 6 Zeichen lang sein'),
      latitude: z.number().optional().nullable(),
      longitude: z.number().optional().nullable(),
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
          imageUrl,
          pinLat,
          pinLng
        }
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

    const updateData: any = {};
    if (data.newPassword) {
      updateData.password = await bcrypt.hash(data.newPassword, 10);
    }
    if (data.newEmail) {
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
