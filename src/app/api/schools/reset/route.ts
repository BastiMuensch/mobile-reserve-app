import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHOOL' || !userSession.schoolId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await request.json();
    
    // Validate confirmation (school name)
    const school = await prisma.school.findUnique({ where: { id: userSession.schoolId } });
    if (!school || data.confirmationName !== school.name) {
      return NextResponse.json({ error: 'Bestätigungsname stimmt nicht überein.' }, { status: 400 });
    }

    // Delete assignments for these requests first (foreign key constraints)
    const requests = await prisma.request.findMany({ where: { schoolId: school.id } });
    const requestIds = requests.map(r => r.id);

    await prisma.$transaction([
      prisma.assignment.deleteMany({
        where: { requestId: { in: requestIds } }
      }),
      prisma.request.deleteMany({
        where: { schoolId: school.id }
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten' }, { status: 500 });
  }
}
