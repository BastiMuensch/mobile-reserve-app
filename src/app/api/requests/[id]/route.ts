import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (userSession.role === 'TEACHER') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    const req = await prisma.request.findUnique({
      where: { id },
      include: { school: true, assignments: { select: { id: true } } },
    });
    if (!req) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (userSession.role === 'SCHOOL' && req.schoolId !== userSession.schoolId) {
      return NextResponse.json({ error: 'Forbidden: You can only delete your own requests.' }, { status: 403 });
    }
    if (userSession.role === 'SCHULAMT' && req.school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: You can only delete requests from your own Schulamt.' }, { status: 403 });
    }

    // Guard: block deletion if active assignments exist
    if (req.assignments.length > 0) {
      return NextResponse.json(
        { error: 'Anforderung hat bereits Einsätze und kann nicht gelöscht werden. Bitte zuerst Einsätze stornieren.' },
        { status: 409 }
      );
    }

    await prisma.request.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete request' }, { status: 500 });
  }
}
