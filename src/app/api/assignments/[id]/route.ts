import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail } from '@/lib/email';

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        teacher: true,
        request: {
          include: { school: true }
        }
      }
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Security: verify this assignment belongs to a school under the user's Schulamt
    if (assignment.request.school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: Assignment does not belong to your Schulamt.' }, { status: 403 });
    }

    await prisma.assignment.delete({
      where: { id: params.id }
    });

    // Check if request has other assignments. If not, set status to PENDING
    const remainingAssignments = await prisma.assignment.count({
      where: { requestId: assignment.requestId }
    });

    if (remainingAssignments === 0) {
      await prisma.request.update({
        where: { id: assignment.requestId },
        data: { status: 'PENDING' }
      });
    } else {
      await prisma.request.update({
        where: { id: assignment.requestId },
        data: { status: 'PARTIALLY_FILLED' }
      });
    }

    // Notify teacher
    if (assignment.teacher.email) {
      const dateStr = new Date(assignment.date).toLocaleDateString('de-DE');
      await sendEmail(
        assignment.teacher.email,
        'Zuweisung aufgehoben / storniert',
        `Hallo ${assignment.teacher.name},\n\nIhre Zuweisung für die Schule ${assignment.request.school.name} am ${dateStr} wurde vom Schulamt storniert/aufgehoben.\n\nBitte prüfen Sie Ihr Dashboard für aktuelle Einsätze.`,
        userSession.id
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error: 'Ein interner Fehler ist aufgetreten.' }, { status: 500 });
  }
}
