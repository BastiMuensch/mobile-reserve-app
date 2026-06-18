import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail, generateIcalEvent } from '@/lib/email';
import { z } from 'zod';

const AssignSchema = z.object({
  requestId: z.string(),
  teacherId: z.string(),
  assignments: z.array(z.object({
    date: z.string(),
    hours: z.number().positive(),
  })),
});

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawData = await request.json();

    const parsed = AssignSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;
    
    // Fetch request to check weeklyHours
    const req = await prisma.request.findUnique({
      where: { id: data.requestId },
      include: { assignments: true, school: { include: { user: true } } }
    });

    if (!req) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (req.school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: Request does not belong to your Schulamt.' }, { status: 403 });
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: data.teacherId },
      include: { user: true, stammschule: true }
    });

    if (!teacher || teacher.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: Teacher does not belong to your Schulamt.' }, { status: 403 });
    }

    // Create assignments
    const assignmentsToCreate = data.assignments.map((a) => ({
      requestId: data.requestId,
      teacherId: data.teacherId,
      date: new Date(a.date),
      hours: a.hours,
    }));

    // Wrap in transaction for atomicity
    await prisma.$transaction(async (tx) => {
      await tx.assignment.createMany({
        data: assignmentsToCreate
      });

      // Check if total assigned hours meet weeklyHours
      const newlyAssignedHours = assignmentsToCreate.reduce((sum: number, a) => sum + a.hours, 0);
      const currentAssignedHours = req.assignments.reduce((sum, a) => sum + a.hours, 0) + newlyAssignedHours;
      const newStatus = currentAssignedHours >= req.weeklyHours ? 'FILLED' : 'PARTIALLY_FILLED';

      // Update request status
      await tx.request.update({
        where: { id: data.requestId },
        data: { status: newStatus }
      });
    });

    if (teacher && teacher.user?.email) {
      const assignmentsList = assignmentsToCreate.map((a) => `- ${new Date(a.date).toLocaleDateString('de-DE')}: ${a.hours} Stunde(n)`).join('\n');
      const emailBodyTeacher = `Ihnen wurden neue Einsatzstunden an der Schule ${req.school.name} zugewiesen.\n\n` +
        `Einsatzdetails:\n` +
        `Datum:\n${assignmentsList}\n` +
        `Start (Unterrichtsstunde): ${req.startHour}. Stunde\n` +
        `Schulart: ${req.schoolType}\n` +
        `Zu vertreten: ${req.substitutedTeacher || 'Nicht angegeben'}\n` +
        `Besonderheiten/Kommentar:\n${req.comments || '-'}`;

      // Create iCal attachment
      const icalEvents = assignmentsToCreate.map(a => {
        const start = new Date(a.date);
        start.setHours(7 + req.startHour, 0, 0, 0); // rough estimate of start time based on startHour (e.g. 1st hour = ~08:00)
        const end = new Date(start);
        end.setHours(start.getHours() + a.hours);
        
        return {
          start,
          end,
          summary: `Mobile Reserve Einsatz: ${req.school.name}`,
          description: emailBodyTeacher,
          location: req.school.address
        };
      });

      const icalContent = generateIcalEvent(icalEvents);

      await sendEmail(
        teacher.user.email,
        `Neuer Einsatz zugewiesen`,
        emailBodyTeacher,
        userSession.id,
        [{ filename: 'einsatz.ics', content: icalContent, contentType: 'text/calendar' }]
      );
    }
    
    if (req.school.user?.email) {
      const assignmentsList = assignmentsToCreate.map((a) => `- ${new Date(a.date).toLocaleDateString('de-DE')}: ${a.hours} Stunde(n)`).join('\n');
      const emailBodySchool = `Der Anforderung wurde die Lehrkraft ${teacher?.name} zugewiesen.\n\n` +
        `Zuweisungsdetails:\n` +
        `Datum:\n${assignmentsList}\n` +
        `Start (Unterrichtsstunde): ${req.startHour}. Stunde\n` +
        `Schulart: ${req.schoolType}\n` +
        `Zu vertreten: ${req.substitutedTeacher || 'Nicht angegeben'}\n` +
        `Besonderheiten/Kommentar:\n${req.comments || '-'}`;

      await sendEmail(
        req.school.user.email,
        `Zuweisung einer Lehrkraft`,
        emailBodySchool,
        userSession.id
      );
    }
    
    return NextResponse.json({ success: true, count: assignmentsToCreate.length }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to assign teacher' }, { status: 500 });
  }
}
