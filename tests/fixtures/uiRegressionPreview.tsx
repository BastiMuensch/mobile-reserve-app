import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SchoolRequestsList } from '../../src/components/school/SchoolRequestsList';
import { SchoolRequestForm } from '../../src/components/school/SchoolRequestForm';
import { Statistics } from '../../src/components/schulamt/Statistics';
import { Button } from '../../src/components/ui/button';
import { ToastProvider } from '../../src/components/ui/toast';
import { school, teacher, uiRequests } from './uiRegressionData';

function Preview() {
  const [wide, setWide] = useState(false);
  const [dark, setDark] = useState(false);
  const [chartsVisible, setChartsVisible] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [action, setAction] = useState('Keine Aktion');
  return <div className={dark ? 'dark' : ''}>
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className="text-2xl font-semibold">Lokale UI-Prüfung – nur erfundene Daten</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setWide(!wide)}>Listenbreite wechseln</Button>
          <Button onClick={() => setDark(!dark)}>Darstellung wechseln</Button>
          <Button onClick={() => setChartsVisible(!chartsVisible)}>Diagramme ein-/ausblenden</Button>
          <Button onClick={() => setEmpty(!empty)}>Testdaten ein-/ausblenden</Button>
        </div>
        <p role="status">{action}</p>
        <div className={wide ? 'grid grid-cols-1 gap-8' : 'grid grid-cols-1 items-start gap-8 lg:grid-cols-3'}>
          {!wide && <div className="min-w-0"><SchoolRequestForm user={{ id: 'ui-user', email: 'school@example.invalid', role: 'SCHULE', schoolId: school.id, teacherId: null }} fetchRequests={() => {}} /></div>}
          <div className={wide ? 'min-w-0' : 'min-w-0 lg:col-span-2'}>
            <SchoolRequestsList requests={empty ? [] : uiRequests} loading={false}
              handleCancel={id => setAction(`Test-Stornierung: ${id}`)}
              handleEndRequest={request => setAction(`Test-Rückkehr: ${request.id}`)} />
          </div>
        </div>
        <section aria-label="Diagramm-Test" style={{ display: chartsVisible ? 'block' : 'none' }}>
          <Statistics teachers={empty ? [] : [teacher]} requests={empty ? [] : uiRequests.slice(0, 3)} />
        </section>
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><ToastProvider><Preview /></ToastProvider></StrictMode>);
