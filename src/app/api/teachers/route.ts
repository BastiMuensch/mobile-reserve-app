export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { getCurrentSchoolYear, schoolYearSchema } from '@/lib/schoolYear';
import { getWeekBounds } from '@/lib/matching';
import { z } from 'zod';
import { POSTAL_CODE_SCHEMA } from '@/lib/geocoding';

const teacherStatusSchema = z.enum(['ACTIVE', 'UNAVAILABLE', 'LEAVE', 'PENDING']);

export async function GET(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  // Personen-, Adress-, Einsatz- und Abwesenheitsdaten sind ausschließlich für die
  // disponierende Stelle bestimmt. Schulen erhalten benötigte Lehrkraftdaten nur über
  // ihre eigenen Anforderungen, nicht als vollständiges Personalverzeichnis.
  if (userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const parsedYear = schoolYearSchema.safeParse(searchParams.get('year') || getCurrentSchoolYear());
  if (!parsedYear.success) {
    return NextResponse.json({ error: 'Ungültiges Schuljahr.' }, { status: 400 });
  }
  const year = parsedYear.data;

  try {
    const whereClause: Prisma.TeacherWhereInput = {
      stammschule: { schulamtId: userSession.id },
    };
    whereClause.schoolYear = year;

    // Abwesenheiten von heute mitladen: Seit die Selbstmeldung einer Lehrkraft nicht mehr
    // dauerhaft `status` auf UNAVAILABLE setzt (sondern einen Absence-Datensatz schreibt),
    // braucht das Dashboard beide Quellen, um "Ungeplante Ausfälle" korrekt anzuzeigen.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const { weekStart, weekEnd } = getWeekBounds(new Date());

    const teachers = await prisma.teacher.findMany({
      where: whereClause,
      include: {
        stammschule: true,
        // Die regelmäßig aktualisierte Reservenliste benötigt nur die laufende
        // Wochenbelastung. Die vollständige Historie besitzt einen eigenen Endpunkt.
        assignments: {
          where: {
            status: { not: 'REJECTED' },
            date: { gte: weekStart, lte: weekEnd },
          },
          select: { id: true, date: true, hours: true, status: true },
        },
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

    // A login account represents one person across school-year rows. A leave
    // recorded on the previous/current row must therefore also block the
    // selected year's row, just as the matching and copy flows already do.
    const teacherIds = teachers.map(teacher => teacher.id);
    const userToTeacherIds = new Map<string, string[]>();
    for (const teacher of teachers) {
      if (!teacher.userId) continue;
      const ids = userToTeacherIds.get(teacher.userId) ?? [];
      ids.push(teacher.id);
      userToTeacherIds.set(teacher.userId, ids);
    }
    const userIds = [...userToTeacherIds.keys()];
    const sharedLeaves = teacherIds.length === 0 ? [] : await prisma.leavePeriod.findMany({
      where: {
        OR: [
          { teacherId: { in: teacherIds } },
          ...(userIds.length > 0 ? [{ teacher: { userId: { in: userIds } } }] : []),
        ],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: todayStart } }] }],
      },
      orderBy: { startDate: 'asc' },
      select: {
        id: true,
        teacherId: true,
        startDate: true,
        endDate: true,
        reportedBy: true,
        createdAt: true,
        updatedAt: true,
        teacher: { select: { userId: true } },
      },
    });

    const leavePeriodsByTeacherId = new Map<string, typeof teachers[number]['leavePeriods']>();
    for (const leave of sharedLeaves) {
      const { teacher: leaveTeacher, ...visibleLeave } = leave;
      const direct = leavePeriodsByTeacherId.get(leave.teacherId) ?? [];
      direct.push(visibleLeave);
      leavePeriodsByTeacherId.set(leave.teacherId, direct);

      if (!leaveTeacher.userId) continue;
      for (const teacherId of userToTeacherIds.get(leaveTeacher.userId) ?? []) {
        if (teacherId === leave.teacherId) continue;
        const inherited = leavePeriodsByTeacherId.get(teacherId) ?? [];
        inherited.push(visibleLeave);
        leavePeriodsByTeacherId.set(teacherId, inherited);
      }
    }

    const teachersWithAbsenceFlag = teachers.map(teacher => ({
      ...teacher,
      leavePeriods: leavePeriodsByTeacherId.get(teacher.id) ?? [],
      isAbsentToday: teacher.absences.length > 0,
      // Läuft heute eine Langzeitabwesenheit? (endDate === null = bis auf Weiteres)
      currentLeave: (leavePeriodsByTeacherId.get(teacher.id) ?? []).find(l =>
        l.startDate <= todayEnd && (!l.endDate || l.endDate >= todayStart)
      ) ?? null,
    }));

    return NextResponse.json(teachersWithAbsenceFlag);
  } catch {
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
      status: teacherStatusSchema.optional().default('ACTIVE'),
      address: z.string().trim().min(1, 'Die postalische Anschrift ist erforderlich.').max(500),
      postalCode: POSTAL_CODE_SCHEMA,
      gender: z.enum(['FEMALE', 'MALE', 'DIVERSE']).optional().nullable(),
      homeLat: z.coerce.number().min(-90).max(90),
      homeLng: z.coerce.number().min(-180).max(180),
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
        address: validatedData.address,
        postalCode: validatedData.postalCode,
        gender: validatedData.gender || null,
        homeLat: validatedData.homeLat,
        homeLng: validatedData.homeLng,
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
  } catch {
    return NextResponse.json({ error: 'Failed to create teacher' }, { status: 500 });
  }
}
