import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkloadOverview } from '../../src/components/schulamt/WorkloadStatistics';
import { ClassContinuityNotice } from '../../src/components/schulamt/ClassContinuityNotice';
import { SchoolRequestForm } from '../../src/components/school/SchoolRequestForm';
import { ToastProvider } from '../../src/components/ui/toast';
import { Button } from '../../src/components/ui/button';
import { buildWorkloadReport } from '../../src/lib/workload';

const report = buildWorkloadReport('2026/2027', [
  { id: 'example-one', name: 'Alexandra Beispiel', maxWeeklyHours: 20, stammschule: { name: 'Grundschule Beispielstadt' }, assignments: [
    { date: '2026-09-22', hours: 5, status: 'ACCEPTED' },
    ...['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(date => ({ date, hours: 5, status: date < '2026-10-08' ? 'ACCEPTED' : 'PENDING' })),
    { date: '2026-10-12', hours: 4, status: 'REJECTED' },
  ] },
  { id: 'example-two', name: 'Kim Muster', maxWeeklyHours: 28, stammschule: { name: 'Mittelschule Musterort' }, assignments: [{ date: '2026-10-06', hours: 6, status: 'ACCEPTED' }] },
  { id: 'example-zero', name: 'Robin Demo', maxWeeklyHours: 14, stammschule: { name: 'Grundschule Beispielstadt' }, assignments: [] },
]);

window.fetch = async () => Response.json({ error: 'Nur lokale Vorschau – keine Speicherung.' }, { status: 400 });

function Preview() {
  const [narrow, setNarrow] = useState(false);
  const [dark, setDark] = useState(false);
  return <div className={dark ? 'dark' : ''}><main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
    <div className={`mx-auto space-y-6 ${narrow ? 'max-w-[390px]' : 'max-w-6xl'}`}>
      <h1 className="text-2xl font-semibold">Klassenhistorie & Unterrichtsstunden – lokale Vorschau</h1>
      <p className="text-sm text-muted-foreground">Ausschließlich erfundene Beispieldaten, keine Verbindung zur Datenbank.</p>
      <div className="flex flex-wrap gap-2"><Button onClick={() => setNarrow(!narrow)}>Schmale Ansicht wechseln</Button><Button onClick={() => setDark(!dark)}>Darstellung wechseln</Button></div>
      <WorkloadOverview report={report} />
      <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Passende Reserve für Klasse 3a</h2><p>Alexandra Beispiel</p><ClassContinuityNotice continuity={{ basis: 'class', days: 3, hours: 15, weekStart: '2026-09-28', weekEnd: '2026-10-04', bonus: 165 }} /></div>
      <SchoolRequestForm user={{ id: 'demo-user', email: 'school@example.invalid', role: 'SCHULE', schoolId: 'demo-school', teacherId: null }} fetchRequests={() => {}} />
    </div>
  </main></div>;
}
createRoot(document.getElementById('root')!).render(<ToastProvider><Preview /></ToastProvider>);
