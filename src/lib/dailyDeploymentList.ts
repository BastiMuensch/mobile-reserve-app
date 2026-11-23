import { assignmentDay, getAssignmentSeries, type ProofAssignment } from './assignmentSeries';
import { deploymentSchoolName } from './schoolLocations';
import { toLocalDateInputValue } from './dateKey';

type DeploymentTeacher = { name: string; stammschule?: { name: string } | null };
export type DeploymentLifecycleEvent = {
  createdAt: Date | string;
  wasOpenEnded: boolean;
  previousEndDate: Date | string | null;
};

type DeploymentRequest = {
  school: { name: string };
  location?: { name: string } | null;
  substitutedTeacher: string;
  status: string;
  endDate?: Date | string | null;
  isOpenEnded?: boolean;
  lifecycleEvents?: DeploymentLifecycleEvent[];
  assignments: (ProofAssignment & { teacherId: string; teacher?: DeploymentTeacher })[];
};

export const deploymentLifecycleFields = { createdAt: true, wasOpenEnded: true, previousEndDate: true } as const;

function wasOpenEnded(request: DeploymentRequest, day: string) {
  // The first subsequent change recorded the state that still applied on this day.
  const nextChange = request.lifecycleEvents?.find(event => toLocalDateInputValue(new Date(event.createdAt)) > day);
  return nextChange
    ? nextChange.wasOpenEnded && !nextChange.previousEndDate
    : request.isOpenEnded === true && !request.endDate;
}

/** Nur tatsächlich gespeicherte, aktive Einsätze am gewählten Tag anzeigen. */
export function dailyDeployments(requests: DeploymentRequest[], teachers: (DeploymentTeacher & { id: string })[], day: string) {
  const teacherById = new Map(teachers.map(teacher => [teacher.id, teacher]));
  return requests.flatMap(request => {
    if (request.status === 'CANCELLED') return [];
    const active = request.assignments.filter(assignment => assignment.status === 'PENDING' || assignment.status === 'ACCEPTED');
    const openEnded = wasOpenEnded(request, day);
    return active.filter(assignment => assignmentDay(assignment.date) === day).map(assignment => {
      const teacher = teacherById.get(assignment.teacherId);
      const series = getAssignmentSeries(assignment, active.filter(item => item.teacherId === assignment.teacherId));
      return {
        id: assignment.id,
        homeSchool: assignment.teacher?.stammschule?.name ?? teacher?.stammschule?.name,
        teacher: assignment.teacher?.name ?? teacher?.name ?? 'Nicht verfügbar',
        start: assignmentDay(series[0].date),
        end: assignmentDay(series[series.length - 1].date),
        openEnded,
        substitutedTeacher: request.substitutedTeacher,
        school: deploymentSchoolName(request),
        pending: assignment.status === 'PENDING',
      };
    });
  }).sort((a, b) => a.school.localeCompare(b.school, 'de')
    || a.substitutedTeacher.localeCompare(b.substitutedTeacher, 'de') || a.teacher.localeCompare(b.teacher, 'de'));
}

export type DailyDeployment = ReturnType<typeof dailyDeployments>[number];

export function isMultiDayDeployment(row: DailyDeployment) {
  return row.openEnded || row.start !== row.end;
}
