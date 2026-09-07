import { z } from 'zod';

export const teacherStatusSchema = z.enum(['ACTIVE', 'UNAVAILABLE', 'LEAVE', 'PENDING']);
export type TeacherStatus = z.infer<typeof teacherStatusSchema>;

/** Empty optional password fields mean "do not change the account password". */
export function omitBlankPassword(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data as { password?: unknown }).password !== '') return data;
  return Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([key]) => key !== 'password'));
}

/**
 * HTML/select controls represent an unset optional value as an empty string,
 * while the API uses null for an intentional clear. Missing partial-PATCH
 * fields are left untouched so they keep their distinct "do not change" meaning.
 */
export function normalizeEmptyOptionalTeacherFields(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const normalized = { ...record };
  if (normalized.email === '') normalized.email = null;
  if (normalized.gender === '') normalized.gender = null;
  return normalized;
}

/** Builds an edit payload without accidentally reintroducing a blank password via a spread. */
export function withOptionalTeacherPassword<T extends { password: string }>(data: T): Omit<T, 'password'> & { password?: string } {
  const { password, ...withoutPassword } = data;
  // Do not trim: whitespace is a valid password character and an intentional
  // all-whitespace password is still subject to the server's length policy.
  return password === '' ? withoutPassword : { ...withoutPassword, password };
}

/** Full edit forms may omit status; never turn that omission into reactivation. */
export function statusForTeacherUpdate(status: TeacherStatus | undefined, existingStatus: string): string {
  return status ?? existingStatus;
}
