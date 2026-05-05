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

  try {
    const p = await params;

    const req = await prisma.request.findUnique({ 
      where: { id: p.id },
      include: { school: true }
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

    if (userSession.role === 'TEACHER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await prisma.request.delete({
      where: { id: p.id }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete request' }, { status: 500 });
  }
}
