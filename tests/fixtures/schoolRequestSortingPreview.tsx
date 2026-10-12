import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SchoolRequestsList } from '../../src/components/school/SchoolRequestsList';
import { openRequest } from './uiRegressionData';
import type { RequestData } from '../../src/types/models';

const request = (name: string, overrides: Partial<RequestData>): RequestData => ({
  ...openRequest, id: name, substitutedTeacher: name, isOpenEnded: false,
  schedule: undefined, weeklyHours: 6, ...overrides,
});
const requests = [
  request('Test-Spaet', { date: '2099-10-20' }),
  request('Test-Frueh', { date: '2099-10-10', priority: 'OTHER', status: 'FILLED' }),
  request('Test-Stunde-5', { date: '2099-10-15', priority: 'FORTBILDUNG', startHour: 5 }),
  request('Test-Stunde-2', { date: '2099-10-15', priority: 'DIENSTBEFREIUNG', startHour: 2, status: 'PARTIALLY_FILLED' }),
  request('Test-Laufend', { date: '2000-01-01', isOpenEnded: true,
    unfilledDays: JSON.stringify([{ date: '2099-10-05', reason: 'Synthetischer Engpass', decidedAt: '2099-10-05T06:00:00Z' }]) }),
  request('Test-Keine-Reserve', { date: '2099-10-22', priority: 'SCHULINTERN', status: 'UNFILLED' }),
  request('Test-Archiv-Alt', { date: '1998-01-01' }),
  request('Test-Archiv-Neu', { date: '1999-01-01', status: 'FILLED' }),
];

function Preview() {
  const [action, setAction] = useState('Keine Aktion');
  return <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
    <h1 className="mb-4 text-xl font-semibold">Sortierungsprüfung – nur erfundene Daten</h1>
    <p role="status" className="mb-4">{action}</p>
    <SchoolRequestsList requests={requests} loading={false}
      handleCancel={id => setAction(`Test-Stornierung: ${id}`)}
      handleEndRequest={req => setAction(`Test-Rückkehr: ${req.id}`)} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);
