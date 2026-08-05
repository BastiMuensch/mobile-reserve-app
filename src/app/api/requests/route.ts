export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { sendEmail } from '@/lib/email';
import { getSessionUser } from '@/lib/auth';
import { getCurrentSchoolYear, getSchoolYearDates } from '@/lib/schoolYear';
import { z } from 'zod';

export async function GET(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  let schoolId = searchParams.get('schoolId');
  const year = searchParams.get('year') || getCurrentSchoolYear();
  const { start: startDate, end: endDate } = getSchoolYearDates(year);

  if (userSession.role === 'SCHOOL') {
    if (!userSession.schoolId) return NextResponse.json({ error: 'Invalid school session' }, { status: 400 });
    schoolId = userSession.schoolId;
  } else if (userSession.role === 'TEACHER') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const whereClause: Prisma.RequestWhereInput = schoolId ? { schoolId } : {};
    if (userSession.role === 'SCHULAMT') {
      whereClause.school = { schulamtId: userSession.id };
    }
    
    // Filter by school year dates. Ein noch laufender Bedarf "bis auf Weiteres" wird
    // bewusst unabhängig davon mitgeliefert: Eine Erkrankung, die über den 31. August
    // reicht, verschwände sonst am 1. September aus der Liste, obwohl sie weiterläuft.
    whereClause.OR = [
      { date: { gte: startDate, lte: endDate } },
      { isOpenEnded: true, endDate: null },
    ];

    const requests = await prisma.request.findMany({
      where: whereClause,
      orderBy: { date: 'asc' },
      include: {
        school: true,
        assignments: {
          include: { teacher: true }
        }
      }
    });
    return NextResponse.json(requests);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHOOL') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();
    
    const RequestSchema = z.object({
      schoolId: z.string().uuid(),
      date: z.string().refine((val) => !isNaN(new Date(val).getTime()), { message: 'Ungültiges Datum' }),
      endDate: z.string().optional().nullable(),
      priority: z.string().default('UNPLANNED_ABSENCE'),
      startHour: z.union([z.string(), z.number()]).transform(v => parseInt(v as string)),
      hours: z.union([z.string(), z.number()]).transform(v => parseInt(v as string)).optional(),
      weeklyHours: z.union([z.string(), z.number()]).transform(v => parseInt(v as string)).optional(),
      schoolType: z.string().default('GRUNDSCHULE'),
      substitutedTeacher: z.string().min(1, 'Bitte geben Sie an, für wen die Vertretung benötigt wird.'),
      schedule: z.string().optional().nullable(),
      qualifications: z.string(),
      comments: z.string().min(1, 'Kommentarfeld (Startzeit/Parken) ist Pflicht.'),
      isOpenEnded: z.boolean().optional().default(false)
    });

    const parsedData = RequestSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const validatedData = parsedData.data;

    if (validatedData.schoolId !== userSession.schoolId) {
      return NextResponse.json({ error: 'Unauthorized schoolId' }, { status: 401 });
    }

    // "Bis auf Weiteres" nur beim ungeplanten Ausfall: Fortbildungen und schulinterne
    // Termine haben immer ein bekanntes Ende, ein offener Bedarf wäre dort ein Versehen.
    if (validatedData.isOpenEnded && validatedData.priority !== 'UNPLANNED_ABSENCE') {
      return NextResponse.json({
        error: 'Ein Bedarf ohne festes Ende ist nur bei einem ungeplanten Ausfall möglich.'
      }, { status: 400 });
    }

    // Ohne Stundenplan wüsste das System bei offenem Ende nicht, wie viele Stunden an
    // welchem Wochentag anfallen - und würde jeden Werktag mit request.hours ansetzen.
    if (validatedData.isOpenEnded && !validatedData.schedule) {
      return NextResponse.json({
        error: 'Für einen Bedarf ohne festes Ende ist der Stundenplan erforderlich.'
      }, { status: 400 });
    }

    if (validatedData.isOpenEnded && validatedData.endDate) {
      return NextResponse.json({
        error: 'Ein Bedarf ohne festes Ende darf kein Enddatum haben.'
      }, { status: 400 });
    }

    const newRequest = await prisma.request.create({
      data: {
        schoolId: validatedData.schoolId,
        date: new Date(validatedData.date),
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : null,
        priority: validatedData.priority,
        startHour: validatedData.startHour,
        hours: validatedData.hours || 0,
        weeklyHours: validatedData.weeklyHours || validatedData.hours || 0,
        schoolType: validatedData.schoolType,
        substitutedTeacher: validatedData.substitutedTeacher,
        schedule: validatedData.schedule || null,
        qualifications: validatedData.qualifications,
        comments: validatedData.comments,
        isOpenEnded: validatedData.isOpenEnded,
        status: 'PENDING'
      }
    });

    const school = await prisma.school.findUnique({
      where: { id: validatedData.schoolId },
      include: { schulamt: true }
    });
    if (school) {
      const dateStr = new Date(newRequest.date).toLocaleDateString('de-DE');
      const endDateStr = newRequest.endDate ? ` bis ${new Date(newRequest.endDate).toLocaleDateString('de-DE')}` : '';
      const emailBody = `Die Schule ${school.name} hat einen Bedarf für insgesamt ${newRequest.weeklyHours} Stunden gemeldet.\n\n` +
        `Bedarfsdetails:\n` +
        `Datum: ${dateStr}${endDateStr}\n` +
        `Start (Unterrichtsstunde): ${newRequest.startHour}. Stunde\n` +
        `Schulart: ${newRequest.schoolType}\n` +
        `Zu vertreten: ${newRequest.substitutedTeacher || 'Nicht angegeben'}\n` +
        `Längerfristig: ${newRequest.schedule ? 'Ja' : 'Nein'}\n` +
        `Besonderheiten/Kommentar:\n${newRequest.comments || '-'}`;

      // Dynamically look up the schulamt user's email
      const schulamtEmail = school.schulamt?.email;
      if (schulamtEmail) {
        await sendEmail(
          schulamtEmail,
          `Neue Anforderung von ${school.name}`,
          emailBody,
          school.schulamt?.id
        );
      }
    }
    
    return NextResponse.json(newRequest, { status: 201 });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error: 'Ein interner Fehler ist aufgetreten.' }, { status: 500 });
  }
}
