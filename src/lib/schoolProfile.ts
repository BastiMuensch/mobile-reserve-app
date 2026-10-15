/** Arrival and teaching notes are the required part; photos and parking are optional. */
export function hasSchoolProfile(school: { generalInfo?: string | null }): boolean {
  return Boolean(school.generalInfo?.trim());
}
