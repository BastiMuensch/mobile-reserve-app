import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  
  // Only SCHULAMT or the teacher themselves can view assignment history
  if (userSession.role === 'SCHOOL') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (userSession.role === 'TEACHER' && !userSession.teachers?.some(t => t.id === id)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (userSession.role === 'SCHULAMT') {
    const teacherCheck = await prisma.teacher.findUnique({ where: { id: id }, include: { stammschule: true } });
    if (!teacherCheck || teacherCheck.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    const assignments = await prisma.assignment.findMany({
      where: { teacherId: id },
      include: {
        request: {
          include: {
            school: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });
    
    return NextResponse.json(assignments);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch assignments' }, { status: 500 });
  }
}
