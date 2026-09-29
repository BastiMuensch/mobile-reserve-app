import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TeacherQualificationFields } from '../../src/components/teacher/TeacherQualificationFields';
import { SchoolRequestsList } from '../../src/components/school/SchoolRequestsList';
import { Button } from '../../src/components/ui/button';
import type { TeacherQualificationForm } from '../../src/lib/teacherQualifications';
import { teacher, uiRequests } from './uiRegressionData';

function Preview() {
  const [details, setDetails] = useState<TeacherQualificationForm>({ qualificationType: null, canTeachSports: null });
  const [saved, setSaved] = useState(details);
  const [savedOnce, setSavedOnce] = useState(false);
  const assignedTeacher = { ...teacher, ...saved, name: 'Alexandra Muster' };
  const request = { ...uiRequests[1], substitutedTeacher: 'Maria Beispiel', qualifications: 'Grundschule', assignments: uiRequests[1].assignments.map(assignment => ({ ...assignment, teacher: assignedTeacher })) };
  return <main className="min-h-screen bg-background p-5 text-foreground sm:p-8">
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Vorschau · erfundene Beispieldaten</p>
        <h1 className="text-2xl font-bold">Qualifikation der Mobilen Reserve</h1>
        <p className="text-sm text-muted-foreground">Oben ergänzt die Reserve ihre Angaben. Unten sieht die Schule sie nach Klick auf „Alexandra Muster“.</p>
      </header>
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Angaben der Mobilen Reserve</h2>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); setSaved(details); setSavedOnce(true); }}>
          <TeacherQualificationFields value={details} onChange={setDetails} />
          <Button type="submit">Beispiel übernehmen</Button>
          {savedOnce && <p role="status" className="text-sm text-primary">Beispiel aktualisiert. Die Angaben sind unten bei der zugewiesenen Person sichtbar.</p>}
        </form>
      </section>
      <section aria-label="Ansicht der Schulleitung" className="space-y-3">
        <h2 className="text-lg font-semibold">So sieht es die Schulleitung</h2>
        <SchoolRequestsList requests={[request]} loading={false} handleCancel={() => {}} handleEndRequest={() => {}} />
      </section>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
