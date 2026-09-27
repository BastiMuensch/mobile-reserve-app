/** Verbindliche Einsatzgrenze; ein Grund wird bewusst nicht erfasst. */
export function canTeacherWorkAtSchool(
  teacher: { stammschuleId: string; onlyStammschule?: boolean },
  schoolId: string,
): boolean {
  return !teacher.onlyStammschule || teacher.stammschuleId === schoolId;
}
