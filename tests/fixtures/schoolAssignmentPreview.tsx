import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SchoolRequestsList } from '../../src/components/school/SchoolRequestsList';
import { openRequest, teacher } from './uiRegressionData';
import type { AssignmentData, RequestData } from '../../src/types/models';

const reserve = {
  ...teacher, name: 'Alexandra Muster', phone: '+49 30 5550100',
  email: 'alexandra.muster@example.invalid',
};
const assignment = (id: string, date: string, hours: number, lessonHours: string | null, status: AssignmentData['status']): AssignmentData => ({
  id, requestId: 'school-timing-example', teacherId: reserve.id, teacher: reserve,
  date, hours, lessonHours, status,
});
const request: RequestData = {
  ...openRequest, id: 'school-timing-example', substitutedTeacher: 'Johanna Beispiel',
  date: '2099-10-19', endDate: '2099-10-22', isOpenEnded: false,
  startHour: 1, hours: 6, weeklyHours: 24, schedule: undefined,
  comments: undefined, status: 'PARTIALLY_FILLED',
  assignments: [
    assignment('four-hours', '2099-10-19', 4, '[3,4,5,6]', 'PENDING'),
    assignment('gaps', '2099-10-20', 2, '[1,3]', 'ACCEPTED'),
    assignment('legacy', '2099-10-21', 4, null, 'ACCEPTED'),
    assignment('rejected', '2099-10-22', 1, '[9]', 'REJECTED'),
  ],
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Vorschau · erfundene Beispieldaten</p>
        <h1 className="text-2xl font-bold">Einsatzplanung der Schule</h1>
        <p className="text-sm text-muted-foreground">Für Einsatzstunden und Kontakt auf „Alexandra Muster“ klicken.</p>
        <SchoolRequestsList requests={[request]} loading={false} handleCancel={() => {}} handleEndRequest={() => {}} />
      </div>
    </main>
  </StrictMode>,
);
