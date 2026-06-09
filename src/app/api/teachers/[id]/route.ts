import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { z } from 'zod';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const p = await params;
    const data = await request.json();

    const TeacherUpdateSchema = z.object({
      name: z.string().min(1, 'Name ist erforderlich').optional(),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      stammschuleId: z.string().uuid('Ungültige Schul-ID').optional(),
      maxWeeklyHours: z.union([z.string(), z.number()]).transform(v => parseInt(v as string)).optional(),
      isPartTime: z.boolean().optional(),
      schedule: z.any().optional().nullable(),
      qualifications: z.string().optional(),
      status: z.string().optional(),
      address: z.string().optional().nullable(),
      gender: z.enum(['FEMALE', 'MALE', 'DIVERSE']).optional().nullable(),
      homeLat: z.union([z.string(), z.number()]).transform(v => parseFloat(v as string)).optional(),
      homeLng: z.union([z.string(), z.number()]).transform(v => parseFloat(v as string)).optional(),
      preferredType: z.enum(['GRUNDSCHULE', 'MITTELSCHULE', 'BOTH']).optional(),
      password: z.string().optional().nullable(),
    });

    const parsedData = TeacherUpdateSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const validatedData = parsedData.data;

    const existingTeacher = await prisma.teacher.findUnique({
      where: { id: p.id },
      include: { stammschule: true }
    });

    if (!existingTeacher || existingTeacher.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: You can only modify teachers from your own Schulamt.' }, { status: 403 });
    }

    const isFullUpdate = validatedData.name !== undefined;
    let finalData: any = { ...validatedData };
    delete finalData.password;

    if (isFullUpdate) {
      let lat = validatedData.homeLat;
      let lng = validatedData.homeLng;
      
      if (validatedData.address) {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(validatedData.address)}`, {
          headers: { 'User-Agent': 'MobileReservenApp/1.0' }
        });
        const geo = await res.json();
        if (geo && geo.length > 0) {
          lat = parseFloat(geo[0].lat);
          lng = parseFloat(geo[0].lon);
        }
      }

      finalData = {
        name: validatedData.name,
        email: validatedData.email || null,
        phone: validatedData.phone || null,
        stammschuleId: validatedData.stammschuleId,
        maxWeeklyHours: validatedData.maxWeeklyHours !== undefined ? validatedData.maxWeeklyHours : existingTeacher.maxWeeklyHours,
        isPartTime: validatedData.isPartTime !== undefined ? validatedData.isPartTime : existingTeacher.isPartTime,
        schedule: validatedData.isPartTime && validatedData.schedule ? JSON.stringify(validatedData.schedule) : null,
        qualifications: validatedData.qualifications !== undefined ? validatedData.qualifications : existingTeacher.qualifications,
        status: validatedData.status || 'ACTIVE',
        preferredType: validatedData.preferredType !== undefined ? validatedData.preferredType : existingTeacher.preferredType,
        gender: validatedData.gender || null,
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

    if (isFullUpdate && validatedData.password) {
      const rawEmail = validatedData.email || `${validatedData.name?.toLowerCase().replace(/[^a-z0-9]/g, '')}@lehrer.de`;
      const userEmail = rawEmail.trim().toLowerCase();
      const hashedPassword = await bcrypt.hash(validatedData.password, 10);
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
    } else if (isFullUpdate && validatedData.email) {
       let user = teacher.userId ? await prisma.user.findUnique({ where: { id: teacher.userId } }) : null;
       if (user) {
         await prisma.user.update({
           where: { id: user.id },
           data: { email: validatedData.email.trim().toLowerCase() }
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

    // Delete associated user account if exists
    if (existingTeacher.userId) {
      await prisma.user.delete({
        where: { id: existingTeacher.userId }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete teacher' }, { status: 500 });
  }
}
