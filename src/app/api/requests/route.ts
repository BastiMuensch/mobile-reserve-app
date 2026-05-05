import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { getSessionUser } from '@/lib/auth';
import { getCurrentSchoolYear, getSchoolYearDates } from '@/lib/schoolYear';

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
    let whereClause: any = schoolId ? { schoolId } : {};
    if (userSession.role === 'SCHULAMT') {
      whereClause.school = { schulamtId: userSession.id };
    }
    
    // Filter by school year dates
    whereClause.date = {
      gte: startDate,
      lte: endDate
    };

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
    
    if (data.schoolId !== userSession.schoolId) {
      return NextResponse.json({ error: 'Unauthorized schoolId' }, { status: 401 });
    }
    
    // Ensure comments are present if we want to enforce it. The schema allows null but the prompt asks to make it mandatory on frontend.
    if (!data.comments || data.comments.trim() === '') {
      return NextResponse.json({ error: 'Kommentarfeld (Startzeit/Parken) ist Pflicht.' }, { status: 400 });
    }

    if (!data.date || !data.schoolId) {
      return NextResponse.json({ error: 'Datum und Schule sind erforderlich.' }, { status: 400 });
    }

    const newRequest = await prisma.request.create({
      data: {
        schoolId: data.schoolId,
        date: new Date(data.date),
        endDate: data.endDate ? new Date(data.endDate) : null,
        priority: data.priority || 'ERKRANKUNG',
        startHour: data.startHour ? parseInt(data.startHour) : 1,
        hours: data.hours ? parseInt(data.hours) : 0,
        weeklyHours: data.weeklyHours ? parseInt(data.weeklyHours) : (data.hours ? parseInt(data.hours) : 0),
        grade: data.grade ? parseInt(data.grade) : 0,
        qualifications: data.qualifications,
        comments: data.comments,
        status: 'PENDING'
      }
    });

    const school = await prisma.school.findUnique({ where: { id: data.schoolId } });
    if (school) {
      const dateStr = new Date(newRequest.date).toLocaleDateString('de-DE');
      const endDateStr = newRequest.endDate ? ` bis ${new Date(newRequest.endDate).toLocaleDateString('de-DE')}` : '';
      const emailBody = `Die Schule ${school.name} hat einen Bedarf für insgesamt ${newRequest.weeklyHours} Stunden gemeldet.\n\n` +
        `Bedarfsdetails:\n` +
        `Datum: ${dateStr}${endDateStr}\n` +
        `Start (Unterrichtsstunde): ${newRequest.startHour}. Stunde\n` +
        `Klassenstufe: ${newRequest.grade > 0 ? newRequest.grade + '. Klasse' : 'Nicht angegeben'}\n` +
        `Besonderheiten/Kommentar:\n${newRequest.comments || '-'}`;

      await sendEmail(
        'schulamt@landkreis.de',
        `Neue Anforderung von ${school.name}`,
        emailBody
      );
    }
    
    return NextResponse.json(newRequest, { status: 201 });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Failed to create request' }, { status: 500 });
  }
}
