import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { activeSpecialistFields } from '@/lib/specialistFields';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'SCHOOL' || !user.schoolId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const school = await prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { schulamt: { select: { schulamtProfile: { select: { requestUrgencyNoteEnabled: true, specialistRequestsEnabled: true, specialistFields: true } } } } },
    });
    const profile = school?.schulamt?.schulamtProfile;
    return NextResponse.json({ requestUrgencyNoteEnabled: profile?.requestUrgencyNoteEnabled === true, specialistFields: activeSpecialistFields(profile) });
  } catch {
    return NextResponse.json({ error: 'Die Optionen zur Bedarfsmeldung konnten nicht geladen werden.' }, { status: 500 });
  }
}
