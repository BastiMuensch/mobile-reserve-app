export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';

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
    
    let lat = data.latitude || 48.0;
    let lng = data.longitude || 10.5;

    if (data.address && !data.latitude) {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(data.address)}`, {
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

    const email = data.email || `${data.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@schule.de`;
    const hashedPassword = await bcrypt.hash(data.password, 10);

    const school = await prisma.school.create({
      data: {
        name: data.name,
        address: data.address,
        type: data.type,
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
      include: { user: true }
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
      updateData.email = data.newEmail;
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
  }
}
