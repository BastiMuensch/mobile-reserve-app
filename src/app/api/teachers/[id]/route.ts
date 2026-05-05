import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const p = await params;
    const data = await request.json();

    const existingTeacher = await prisma.teacher.findUnique({
      where: { id: p.id },
      include: { stammschule: true }
    });

    if (!existingTeacher || existingTeacher.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: You can only modify teachers from your own Schulamt.' }, { status: 403 });
    }

    const isFullUpdate = data.name !== undefined;
    let finalData = { ...data };

    if (isFullUpdate) {
      let lat = data.homeLat;
      let lng = data.homeLng;
      
      if (data.address) {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(data.address)}`, {
          headers: { 'User-Agent': 'MobileReservenApp/1.0' }
        });
        const geo = await res.json();
        if (geo && geo.length > 0) {
          lat = parseFloat(geo[0].lat);
          lng = parseFloat(geo[0].lon);
        }
      }

      finalData = {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        stammschuleId: data.stammschuleId,
        maxWeeklyHours: parseInt(data.maxWeeklyHours),
        isPartTime: data.isPartTime || false,
        schedule: data.isPartTime && data.schedule ? JSON.stringify(data.schedule) : null,
        qualifications: data.qualifications,
        status: data.status || 'ACTIVE',
        preferredType: data.preferredType,
      };

      if (lat && lng) {
        finalData.homeLat = lat;
        finalData.homeLng = lng;
      }
    }

    const teacher = await prisma.teacher.update({
      where: { id: p.id },
      data: finalData
    });

    if (isFullUpdate && data.password) {
      const userEmail = data.email || `${data.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@lehrer.de`;
      const hashedPassword = await bcrypt.hash(data.password, 10);
      let user = teacher.userId ? await prisma.user.findUnique({ where: { id: teacher.userId } }) : null;
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { email: userEmail, password: hashedPassword }
        });
      } else {
        const newUser = await prisma.user.create({
          data: { email: userEmail, password: hashedPassword, role: 'TEACHER' }
        });
        await prisma.teacher.update({ where: { id: p.id }, data: { userId: newUser.id } });
      }
    } else if (isFullUpdate && data.email) {
       let user = teacher.userId ? await prisma.user.findUnique({ where: { id: teacher.userId } }) : null;
       if (user) {
         await prisma.user.update({
           where: { id: user.id },
           data: { email: data.email }
         });
       }
    }

    return NextResponse.json(teacher);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update teacher' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const p = await params;
    
    const existingTeacher = await prisma.teacher.findUnique({
      where: { id: p.id },
      include: { stammschule: true }
    });

    if (!existingTeacher || existingTeacher.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: You can only delete teachers from your own Schulamt.' }, { status: 403 });
    }

    await prisma.teacher.delete({
      where: { id: p.id }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete teacher' }, { status: 500 });
  }
}
