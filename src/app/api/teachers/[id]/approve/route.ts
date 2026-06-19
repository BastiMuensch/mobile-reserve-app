export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const teacher = await prisma.teacher.findUnique({
      where: { id },
      include: { stammschule: true }
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
    }

    if (teacher.stammschule.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const updatedTeacher = await prisma.teacher.update({
      where: { id },
      data: { status: 'ACTIVE' }
    });

    return NextResponse.json(updatedTeacher);
  } catch (error) {
    console.error('Failed to approve teacher:', error);
    return NextResponse.json({ error: 'Failed to approve teacher' }, { status: 500 });
  }
}
