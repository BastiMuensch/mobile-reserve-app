import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail } from '@/lib/email';

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { status } = await request.json(); // "ACCEPTED" or "REJECTED"
    
    if (status !== 'ACCEPTED' && status !== 'REJECTED') {
      return NextResponse.json({ error: 'Invalid status. Must be ACCEPTED or REJECTED.' }, { status: 400 });
    }
    
    // Optional: verify that the teacher updating this assignment is actually assigned to it
    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: { 
        teacher: true,
        request: {
          include: {
            school: {
              include: {
                schulamt: true
              }
            }
          }
        }
      }
    });

    if (!assignment || assignment.teacher.userId !== userSession.id) {
      return NextResponse.json({ error: 'Not your assignment' }, { status: 403 });
    }

    const updatedAssignment = await prisma.assignment.update({
      where: { id: params.id },
      data: { status }
    });

    // Recalculate Request status
    if (status === 'REJECTED') {
      const allAssignments = await prisma.assignment.findMany({
        where: { requestId: assignment.requestId, status: { not: 'REJECTED' } }
      });
      const filledHours = allAssignments.reduce((sum, a) => sum + a.hours, 0);
      
      const request = await prisma.request.findUnique({ where: { id: assignment.requestId } });
      if (request) {
        let newStatus = 'PARTIALLY_FILLED';
        if (filledHours === 0) newStatus = 'PENDING';
        else if (filledHours >= request.weeklyHours) newStatus = 'FILLED'; // Edge case

        await prisma.request.update({
          where: { id: request.id },
          data: { status: newStatus }
        });
      }
    }

    const schulamtEmail = assignment.request.school.schulamt?.email;
    if (schulamtEmail) {
      const statusText = status === 'ACCEPTED' ? 'akzeptiert' : 'abgelehnt';
      const dateStr = new Date(assignment.date).toLocaleDateString('de-DE');
      const emailBody = `Die Lehrkraft ${assignment.teacher.name} hat den Einsatz an der Schule ${assignment.request.school.name} am ${dateStr} ${statusText}.`;
      await sendEmail(schulamtEmail, `Status Update: Mobile Reserve - ${assignment.teacher.name}`, emailBody);
    }

    return NextResponse.json(updatedAssignment);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
