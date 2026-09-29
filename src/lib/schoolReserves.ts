import { toLocalDateInputValue } from './dateKey';

export type ReserveAssignmentInput = {
  id: string;
  requestId: string;
  date: Date;
  hours: number;
  status: string;
  school: { id: string; name: string };
};
export type ReserveAssignmentGroup = {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  hoursPerDay: number;
  school: { id: string; name: string };
  confirmation: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  phase: 'CURRENT' | 'PLANNED' | 'ENDED' | 'CANCELLED';
};
export type SchoolReservesData = {
  schoolYear: string;
  today: string;
  schoolName: string;
  reserveNotificationsEnabled: boolean;
  notificationEmail: string;
  teachers: { id: string; name: string; assignments: ReserveAssignmentGroup[] }[];
};

/** Combine only adjacent calendar days with exactly the same assignment facts.
 * Weekends, schedule gaps, changed hours and confirmation states stay visible.
 */
export function groupReserveAssignments(assignments: ReserveAssignmentInput[], today: string): ReserveAssignmentGroup[] {
  const groups: (ReserveAssignmentGroup & { requestId: string })[] = [];
  const sorted = [...assignments].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  for (const assignment of sorted) {
    const day = toLocalDateInputValue(assignment.date);
    const confirmation = assignment.status === 'ACCEPTED' ? 'ACCEPTED' : assignment.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    const phase = confirmation === 'REJECTED' ? 'CANCELLED' : day < today ? 'ENDED' : day > today ? 'PLANNED' : 'CURRENT';
    const prior = groups.at(-1);
    const adjacent = prior && Date.parse(`${day}T00:00:00Z`) - Date.parse(`${prior.endDate}T00:00:00Z`) === 86_400_000;
    if (prior && adjacent && prior.requestId === assignment.requestId && prior.school.id === assignment.school.id && prior.hoursPerDay === assignment.hours && prior.confirmation === confirmation && prior.phase === phase) {
      prior.endDate = day;
      prior.days += 1;
    } else {
      groups.push({ id: assignment.id, requestId: assignment.requestId, startDate: day, endDate: day, days: 1, hoursPerDay: assignment.hours, school: { id: assignment.school.id, name: assignment.school.name }, confirmation, phase });
    }
  }
  return groups.map(group => ({
    id: group.id, startDate: group.startDate, endDate: group.endDate, days: group.days,
    hoursPerDay: group.hoursPerDay, school: group.school, confirmation: group.confirmation, phase: group.phase,
  }));
}
