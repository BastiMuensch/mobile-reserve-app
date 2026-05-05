import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rankCandidates } from '@/lib/matching';
import { getSessionUser } from '@/lib/auth';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const p = await params;
    
    // Fetch request
    const request = await prisma.request.findUnique({
      where: { id: p.requestId },
      include: { school: true }
    });

    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Fetch all teachers
    const allTeachers = await prisma.teacher.findMany({
      include: {
        assignments: true
      }
    });

    const ranked = rankCandidates(request, request.school, allTeachers as any);

    return NextResponse.json(ranked);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to match candidates' }, { status: 500 });
  }
}
