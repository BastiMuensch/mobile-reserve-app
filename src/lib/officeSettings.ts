import { prisma } from '@/lib/prisma';
import { activeSpecialistFields } from '@/lib/specialistFields';

/** Settings of one Schulamt that shape forms of its schools and reserves. */
export async function officeFormSettings(schulamtId: string | null | undefined) {
  const profile = schulamtId ? await prisma.schulamtProfile.findUnique({
    where: { userId: schulamtId },
    select: { schoolDistricts: true, specialistRequestsEnabled: true, specialistFields: true },
  }) : null;
  return {
    schoolDistricts: profile?.schoolDistricts ?? [],
    specialistFields: activeSpecialistFields(profile),
  };
}
