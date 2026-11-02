import { z } from 'zod';
import { isValidDateKey, parseDateKeyStrict, toLocalDateInputValue } from './dateKey';

export const requestLifecycleSchema = z.union([
  // keepToday: a reserve may already be on site; today's assignment stays reportable.
  z.object({ action: z.literal('CANCEL'), keepToday: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('END').optional(), lastDay: z.string().refine(isValidDateKey, 'Bitte einen gültigen letzten Einsatztag wählen.') }).strict(),
]);
export type RequestLifecycleChange = z.infer<typeof requestLifecycleSchema>;

/** Reapply only cancellations that covered this assignment when originally reported. */
export function lifecycleEventCancelsAssignment(date: Date, event: { action: string; lastDay: Date | null; createdAt: Date }) {
  if (event.action !== 'END' && event.action !== 'CANCEL') return false;
  const day = toLocalDateInputValue(date);
  // A retrospective return preserves work from days already past at reporting time.
  return day >= toLocalDateInputValue(event.createdAt)
    && (event.lastDay === null || day > toLocalDateInputValue(event.lastDay));
}

export function requestLifecyclePlan(request: {
  date: Date | string; endDate?: Date | string | null; isOpenEnded?: boolean; status: string;
}, input: RequestLifecycleChange, now: Date = new Date()) {
  const todayKey = toLocalDateInputValue(now);
  const yesterday = parseDateKeyStrict(todayKey);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const startKey = toLocalDateInputValue(new Date(request.date));
  const existingEnd = request.endDate ? parseDateKeyStrict(toLocalDateInputValue(new Date(request.endDate))) : !request.isOpenEnded ? parseDateKeyStrict(startKey) : null;
  const today = parseDateKeyStrict(todayKey);
  const keepToday = input.action === 'CANCEL' && input.keepToday === true
    && startKey <= todayKey && (!existingEnd || existingEnd >= today);
  const lastDay = input.action === 'CANCEL'
    ? keepToday ? today : (existingEnd && existingEnd < yesterday ? existingEnd : yesterday)
    : parseDateKeyStrict(input.lastDay);
  const lastKey = lastDay.toISOString().slice(0, 10);
  if (input.action !== 'CANCEL') {
    if (lastKey < startKey) throw new Error('Der letzte Einsatztag liegt vor dem Bedarf. Bitte stattdessen stornieren.');
    const fixedEnd = request.endDate ? toLocalDateInputValue(new Date(request.endDate)) : !request.isOpenEnded ? startKey : null;
    if (fixedEnd && lastKey > fixedEnd) throw new Error('Der letzte Einsatztag darf das bisherige Ende nicht verlängern.');
  }
  // A late report can shorten the demand, but never silently erase recorded past work.
  const cancelAfter = lastDay < yesterday ? yesterday : lastDay;
  return {
    lastDay,
    cancelAfter,
    entirelyCancelled: input.action === 'CANCEL' && !keepToday && startKey >= todayKey,
    keptToday: keepToday,
    action: input.action === 'CANCEL' ? 'CANCEL' : 'END',
  };
}
