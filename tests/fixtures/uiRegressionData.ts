import type { RequestData, SchoolData, TeacherData } from '../../src/types/models';

export const school: SchoolData = {
  id: 'ui-school', name: 'Grundschule Musterort', address: 'Musterweg 1',
  type: 'GRUNDSCHULE', latitude: null, longitude: null,
};

export const teacher: TeacherData = {
  id: 'ui-teacher', name: 'Alexandra Muster-Lehrkraft', stammschuleId: school.id,
  maxWeeklyHours: 28, assignedHours: 12, isPartTime: false,
  qualifications: 'Grundschule', status: 'ACTIVE', homeLat: 0, homeLng: 0,
  preferredType: 'GRUNDSCHULE', schoolYear: '2099/2100', stammschule: school,
  assignments: [], email: 'reserve@example.invalid',
};

export const openRequest: RequestData = {
  id: 'ui-open', schoolId: school.id, school, date: '2099-09-14',
  priority: 'UNPLANNED_ABSENCE', startHour: 2, hours: 6, weeklyHours: 22,
  schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Johanna Muster-Langnamensvertretung',
  schedule: '{"1":[2,3,4,5,6]}', qualifications: 'Grundschule, Mittelschule',
  comments: 'Bitte am Eingang beim Sekretariat melden.\nBeginn um 08:00 Uhr.',
  status: 'PENDING', assignments: [], isOpenEnded: true,
};

export const uiRequests: RequestData[] = [
  openRequest,
  { ...openRequest, id: 'ui-filled', status: 'FILLED', isOpenEnded: false,
    schedule: undefined, weeklyHours: 6,
    assignments: [{ id: 'ui-assignment', requestId: 'ui-filled', teacherId: teacher.id,
      teacher, date: '2099-09-14', hours: 6, status: 'ACCEPTED' }] },
  { ...openRequest, id: 'ui-unfilled', status: 'UNFILLED', isOpenEnded: false,
    unfilledReason: 'Keine Reserve im gewählten Zeitraum verfügbar.' },
  { ...openRequest, id: 'ui-archived', date: '2000-01-03', endDate: '2000-01-05',
    endedAt: '2000-01-05', isOpenEnded: false },
];
