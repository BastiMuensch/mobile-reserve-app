import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { enqueueHomeSchoolNotifications } from '@/lib/homeSchoolNotifications';
import { deliverOutboxIds } from '@/lib/emailOutbox';
import { toCanonicalUtcDate } from '@/lib/dateKey';

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

    const home = await prisma.$transaction(async tx => {
      const home = await enqueueHomeSchoolNotifications(tx, {
        where: { requestId: { in: requestIds }, status: { not: 'REJECTED' }, date: { gte: toCanonicalUtcDate(new Date()) } },
        event: 'CANCELLED', schulamtId: school.schulamtId,
      });
      await tx.assignment.deleteMany({
        where: { requestId: { in: requestIds } }
      });
      await tx.request.deleteMany({
        where: { schoolId: school.id }
      });
      return home;
    }, { isolationLevel: 'Serializable' });
    const delivery = await deliverOutboxIds(home.outboxIds);
    if (delivery.delivered < home.outboxIds.length) home.warnings.push('Mindestens eine E-Mail wurde nicht sofort zugestellt.');

    return NextResponse.json({ success: true, notificationWarning: home.warnings.length > 0, notificationWarnings: home.warnings.length ? home.warnings : undefined });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten' }, { status: 500 });
  }
}
