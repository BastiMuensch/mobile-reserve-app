import { z } from 'zod';

export const schoolOfficeMessageSchema = z.object({
  note: z.string().trim().max(2000, 'Die Schulnachricht darf höchstens 2000 Zeichen lang sein.'),
  previousNote: z.string().max(2000).nullable(),
}).strict();

export function mayReadSchoolOfficeMessage(
  user: { id: string; role: string; schoolId?: string | null },
  request: { schoolId: string; school: { schulamtId: string | null } },
): boolean {
  return (user.role === 'SCHOOL' && user.schoolId === request.schoolId)
    || (user.role === 'SCHULAMT' && user.id === request.school.schulamtId);
}
