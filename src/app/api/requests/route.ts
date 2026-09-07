export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { getSessionUser } from '@/lib/auth';
import { getCurrentSchoolYear, getSchoolYearDates, schoolYearSchema } from '@/lib/schoolYear';
import { CreateRequestSchema, getScheduleHourTotals, parseTimetableSchedule } from '@/lib/requestValidation';
import { toCanonicalUtcDate } from '@/lib/dateKey';
import { buildRequestYearOverlapFilter } from '@/lib/requestYearFilter';
import { matchesRequestIdempotencyFingerprint, requestAttemptFingerprint, requestIdempotencyKeySchema } from '@/lib/requestIdempotency';

function withoutIdempotencyFields<T extends { idempotencyKey?: string | null; idempotencyFingerprint?: string | null }>(request: T) {
  return Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'idempotencyKey' && key !== 'idempotencyFingerprint'));
}

function idempotencyReplayResponse<T extends { idempotencyKey?: string | null; idempotencyFingerprint?: string | null }>(request: T, fingerprint: string) {
  if (!matchesRequestIdempotencyFingerprint(request.idempotencyFingerprint, fingerprint)) {
    return NextResponse.json({ error: 'Dieser Anforderungs-Schlüssel wurde bereits mit anderen Daten verwendet.' }, { status: 409 });
  }
  return NextResponse.json({ ...withoutIdempotencyFields(request), idempotentReplay: true });
}

type RequestNotificationSchool = {
  name: string;
  schulamt: { id: string; email: string } | null;
};

async function createRequestAndNotification({
  idempotencyKey,
  fingerprint,
  normalizedAttempt,
  school,
  emailBody,
}: {
  idempotencyKey: string;
  fingerprint: string;
  normalizedAttempt: Parameters<typeof requestAttemptFingerprint>[0];
  school: RequestNotificationSchool;
  emailBody: string;
}) {
  return prisma.$transaction(async tx => {
    const createdRequest = await tx.request.create({
      data: {
        idempotencyKey,
        idempotencyFingerprint: fingerprint,
        ...normalizedAttempt,
        status: 'PENDING',
      },
    });

    const schulamtEmail = school.schulamt?.email;
    if (!schulamtEmail) {
      return { request: createdRequest, notification: { queued: false as const } };
    }

    try {
      const notification = await enqueueEmailInTransaction(tx, {
        to: schulamtEmail,
        subject: `Neue Anforderung von ${school.name}`,
        body: emailBody,
        schulamtId: school.schulamt?.id,
      });
      return { request: createdRequest, notification };
    } catch {
      // The caller treats this marker as a clear service/configuration error.
      // Throwing from the transaction rolls back both request and outbox intent.
      throw new Error('REQUEST_MAIL_ENQUEUE_FAILED');
    }
  });
}

export async function GET(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  let schoolId = searchParams.get('schoolId');
  const yearParam = searchParams.get('year');
  let year = getCurrentSchoolYear();
  if (yearParam) {
    const parsedYear = schoolYearSchema.safeParse(yearParam);
    if (!parsedYear.success) {
      return NextResponse.json({ error: 'Ungültiges Schuljahr.' }, { status: 400 });
    }
    year = parsedYear.data;
  }
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
    
    Object.assign(whereClause, buildRequestYearOverlapFilter(startDate, endDate));

    const requests = await prisma.request.findMany({
      where: whereClause,
      orderBy: { date: 'asc' },
      include: {
        school: true,
        assignments: {
          include: {
            teacher: userSession.role === 'SCHOOL'
              ? { select: { id: true, name: true, phone: true, email: true, qualifications: true } }
              : true
          }
        }
      }
    });
    return NextResponse.json(requests.map(withoutIdempotencyFields));
  } catch {
    return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHOOL') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();
    
    const parsedData = CreateRequestSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const validatedData = parsedData.data;
    const idempotencyKey = requestIdempotencyKeySchema.safeParse(data.idempotencyKey);
    if (!idempotencyKey.success) {
      return NextResponse.json({ error: idempotencyKey.error.issues[0].message }, { status: 400 });
    }

    if (validatedData.schoolId !== userSession.schoolId) {
      return NextResponse.json({ error: 'Unauthorized schoolId' }, { status: 401 });
    }

    const school = await prisma.school.findUnique({
      where: { id: validatedData.schoolId },
      include: { schulamt: true }
    });
    if (!school) {
      return NextResponse.json({ error: 'Schule nicht gefunden.' }, { status: 404 });
    }

    const canonicalDate = toCanonicalUtcDate(validatedData.date);
    const canonicalEndDate = validatedData.endDate ? toCanonicalUtcDate(validatedData.endDate) : null;
    // Speichere ausschließlich den validierten und normalisierten Stundenplan. Stundenwerte
    // werden daraus serverseitig abgeleitet, damit manipulierte Clientwerte nicht zu einer
    // anderen Anzeige oder Zuweisungslogik führen können.
    const normalizedSchedule = validatedData.schedule
      ? parseTimetableSchedule(validatedData.schedule)
      : null;
    const scheduleStr = normalizedSchedule ? JSON.stringify(normalizedSchedule) : null;
    const scheduleTotals = normalizedSchedule ? getScheduleHourTotals(normalizedSchedule) : null;
    const hours = scheduleTotals?.dailyMaximum ?? validatedData.hours ?? 0;
    const weeklyHours = scheduleTotals?.weeklyTotal ?? hours;
    const normalizedAttempt = {
      schoolId: validatedData.schoolId,
      date: canonicalDate,
      endDate: canonicalEndDate,
      priority: validatedData.priority,
      startHour: normalizedSchedule ? 1 : validatedData.startHour,
      hours,
      weeklyHours,
      schoolType: school.type,
      substitutedTeacher: validatedData.substitutedTeacher,
      schedule: scheduleStr,
      qualifications: validatedData.qualifications,
      comments: validatedData.comments,
      isOpenEnded: validatedData.isOpenEnded,
    };
    const fingerprint = requestAttemptFingerprint(normalizedAttempt);

    // A repeated delivery of the same browser submit must not create a second
    // demand (or notification). The key is scoped to the authenticated school;
    // equal form contents with a fresh key remain a legitimate new demand.
    const previousRequest = await prisma.request.findUnique({
      where: {
        schoolId_idempotencyKey: {
          schoolId: validatedData.schoolId,
          idempotencyKey: idempotencyKey.data,
        },
      },
    });
    if (previousRequest) return idempotencyReplayResponse(previousRequest, fingerprint);

    const dateStr = new Date(normalizedAttempt.date).toLocaleDateString('de-DE');
    const endDateStr = normalizedAttempt.endDate ? ` bis ${new Date(normalizedAttempt.endDate).toLocaleDateString('de-DE')}` : '';
    const emailBody = `Die Schule ${school.name} hat einen Bedarf für insgesamt ${normalizedAttempt.weeklyHours} Stunden gemeldet.\n\n` +
      `Bedarfsdetails:\n` +
      `Datum: ${dateStr}${endDateStr}\n` +
      `Start (Unterrichtsstunde): ${normalizedAttempt.startHour}. Stunde\n` +
      `Schulart: ${normalizedAttempt.schoolType}\n` +
      `Zu vertreten: ${normalizedAttempt.substitutedTeacher || 'Nicht angegeben'}\n` +
      `Längerfristig: ${normalizedAttempt.schedule ? 'Ja' : 'Nein'}\n` +
      `Besonderheiten/Kommentar:\n${normalizedAttempt.comments || '-'}`;

    let committed: Awaited<ReturnType<typeof createRequestAndNotification>>;
    try {
      committed = await createRequestAndNotification({
        idempotencyKey: idempotencyKey.data,
        fingerprint,
        normalizedAttempt,
        school,
        emailBody,
      });
    } catch (error) {
      // Concurrent retries can both miss the preflight lookup. The scoped
      // unique index is the authoritative guard; return the committed row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrentRequest = await prisma.request.findUnique({
          where: {
            schoolId_idempotencyKey: {
              schoolId: validatedData.schoolId,
              idempotencyKey: idempotencyKey.data,
            },
          },
        });
        if (concurrentRequest) {
          return idempotencyReplayResponse(concurrentRequest, fingerprint);
        }
      }
      if (error instanceof Error && error.message === 'REQUEST_MAIL_ENQUEUE_FAILED') {
        return NextResponse.json({ error: 'Die Anforderung konnte nicht sicher gespeichert werden, weil die E-Mail-Benachrichtigung nicht vorgemerkt werden konnte. Bitte prüfen Sie die Mail-Konfiguration und versuchen Sie es erneut.' }, { status: 503 });
      }
      throw error;
    }
    const notificationWarnings: string[] = [];
    if (committed.notification.warning) {
      notificationWarnings.push(committed.notification.warning);
    } else if (committed.notification.outboxId) {
      const delivery = await deliverOutboxIds([committed.notification.outboxId]);
      if (delivery.delivered !== 1) {
        notificationWarnings.push('Die Benachrichtigung wurde zur erneuten Zustellung vorgemerkt.');
      }
    }
    
    return NextResponse.json({
      ...withoutIdempotencyFields(committed.request),
      notificationWarning: Boolean(notificationWarnings?.length),
      notificationWarnings: notificationWarnings.length > 0 ? notificationWarnings : undefined,
    }, { status: 201 });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error: 'Ein interner Fehler ist aufgetreten.' }, { status: 500 });
  }
}
