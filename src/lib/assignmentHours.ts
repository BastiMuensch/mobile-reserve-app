import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { toLocalDateInputValue } from './dateKey';

export const hourCorrectionSchema = z.object({
  proposedHours: z.number().int().min(0).max(24),
  additionalMinutes: z.number().int().min(0).max(1440).default(0),
  additionalTasks: z.string().trim().max(1000).default(''),
  reason: z.string().trim().min(3, 'Bitte einen kurzen Grund angeben.').max(1000),
}).strict().refine(value => value.additionalMinutes === 0 || value.additionalTasks.length >= 3, {
  message: 'Bitte beschreiben Sie die zusätzlichen Aufgaben.', path: ['additionalTasks'],
});
export const hourReviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().trim().max(1000).default(''),
}).strict().refine(value => value.decision !== 'REJECTED' || value.reviewNote.length >= 3, {
  message: 'Bitte begründen Sie die Ablehnung kurz.', path: ['reviewNote'],
});
/** Hours can only be reported for deployment days up to and including today. */
export function isAssignmentDayReached(date: Date | string, now = new Date()) {
  return toLocalDateInputValue(new Date(date)) <= toLocalDateInputValue(now);
}
/** Keep both reporting and existing review history reachable after cancellation. */
export function hasReportableAssignmentDay(assignments: { date: Date | string; status: string; _count?: { hourCorrections: number } }[] | undefined, now = new Date()) {
  return (assignments ?? []).some(assignment =>
    isAssignmentDayReached(assignment.date, now)
    && (['PENDING', 'ACCEPTED'].includes(assignment.status) || (assignment._count?.hourCorrections ?? 0) > 0));
}
export function canCorrectAssignmentHours(assignment: { status: string; date: Date | string }, now = new Date()) {
  return assignment.status === 'ACCEPTED' && isAssignmentDayReached(assignment.date, now);
}

/** Cancellation may release planning, but never erase approved or reported work. */
export function unperformedAssignmentWhere(): Prisma.AssignmentWhereInput {
  return {
    AND: [
      { OR: [{ actualHours: null }, { actualHours: 0 }] },
      { OR: [{ actualAdditionalMinutes: null }, { actualAdditionalMinutes: 0 }] },
    ],
    hourCorrections: { none: { status: 'PENDING', OR: [{ proposedHours: { gt: 0 } }, { additionalMinutes: { gt: 0 } }] } },
  };
}
export type HourCorrectionData = {
  id: string; plannedHours: number; previousActualHours: number | null; previousAdditionalMinutes: number | null;
  proposedHours: number; additionalMinutes: number; additionalTasks: string | null; reason: string;
  status: string; createdAt: string; reviewedAt: string | null; reviewNote: string | null;
};
export type AssignmentHoursData = {
  id: string; date: string; hours: number; actualHours: number | null; actualAdditionalMinutes: number | null;
  status: string; teacher: { name: string }; hourCorrections: HourCorrectionData[];
};
