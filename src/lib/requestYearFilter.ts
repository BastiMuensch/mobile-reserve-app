import type { Prisma } from '@prisma/client';

/**
 * Liefert Bedarfe, deren fachlicher Zeitraum das ausgewählte Schuljahr schneidet.
 * Ein noch laufender Bedarf ohne Enddatum darf in spätere Schuljahre hineinreichen,
 * aber niemals in ein Schuljahr vor seinem Startdatum zurückprojiziert werden.
 */
export function buildRequestYearOverlapFilter(
  schoolYearStart: Date,
  schoolYearEnd: Date
): Prisma.RequestWhereInput {
  return {
    AND: [
      { date: { lte: schoolYearEnd } },
      {
        OR: [
          { endDate: { gte: schoolYearStart } },
          { isOpenEnded: true, endDate: null },
          {
            isOpenEnded: false,
            endDate: null,
            date: { gte: schoolYearStart },
          },
        ],
      },
    ],
  };
}
