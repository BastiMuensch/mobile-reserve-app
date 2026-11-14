import { z } from 'zod';
import { isValidDateKey } from './dateKey';

export const lessonChangeSchema = z.object({
  date: z.string().refine(isValidDateKey, 'Bitte einen gültigen Tag wählen.'),
  lessons: z.array(z.number().int().min(1).max(10)).min(1).max(10)
    .refine(v => new Set(v).size === v.length, 'Stunden dürfen nicht doppelt vorkommen.'),
}).strict();
const historySchema = z.array(lessonChangeSchema.extend({
  id: z.string().uuid(), state: z.enum(['PENDING','APPROVED','REJECTED']),
  createdAt: z.string().datetime(), reviewedAt: z.string().datetime().optional(),
})).max(2000);
export type RequestChange = z.infer<typeof historySchema>[number];
export function parseRequestChanges(value?: string | null): RequestChange[] {
  return value ? historySchema.parse(JSON.parse(value)) : [];
}
export function validRequestChanges(value: string) {
  try { parseRequestChanges(value); return true; } catch { return false; }
}
export function approvedLessons(value: string | null | undefined, date: string): number[] | undefined {
  return parseRequestChanges(value).filter(c => c.date === date && c.state === 'APPROVED').at(-1)?.lessons;
}

export const requestChangeInputSchema = z.discriminatedUnion('action', [
  lessonChangeSchema.extend({ action: z.literal('PROPOSE'), previous: z.string().nullable() }),
  z.object({ action: z.enum(['APPROVE','REJECT']), changeId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('COMMENT'), comments: z.string().trim().max(2000), previous: z.string().nullable() }).strict(),
]);
export type RequestChangeInput = z.infer<typeof requestChangeInputSchema>;
