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
    const { requestId } = await params;

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { school: true },
    });

    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Security: ensure the request belongs to this Schulamt
    if (request.school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only load teachers from THIS Schulamt's schools
    const allTeachers = await prisma.teacher.findMany({
      where: { stammschule: { schulamtId: userSession.id } },
      include: { assignments: { select: { hours: true, date: true } } },
    });

    const ranked = rankCandidates(request, request.school, allTeachers);
    return NextResponse.json({ request, candidates: ranked });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to match candidates' }, { status: 500 });
  }
}
