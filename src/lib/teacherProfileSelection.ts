/** Prefer the row for the active school year; historic data is only a fallback. */
export function selectTeacherProfileRow<T extends { schoolYear: string }>(rows: readonly T[], currentSchoolYear: string): T | undefined {
  return rows.find(row => row.schoolYear === currentSchoolYear) ?? rows[0];
}
