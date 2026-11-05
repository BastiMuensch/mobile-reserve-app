import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SchulamtEinstellungenPage from '../../src/app/schulamt/einstellungen/page';
import { LoginScreen } from '../../src/components/LoginScreen';
import { InitialSetupWizard } from '../../src/components/setup/InitialSetupWizard';
import { PostalCodeLocationPicker } from '../../src/components/teacher/PostalCodeLocationPicker';
import { AssignmentDayBlocks } from '../../src/components/teacher/TeacherNextAssignment';
import { ToastProvider } from '../../src/components/ui/toast';
import { ConfirmProvider } from '../../src/components/ui/confirm-dialog';
import type { TemplateSettingsForm } from '../../src/types/models';
import { openRequest } from './uiRegressionData';

declare global {
  interface Window {
    __uiReview: {
      created: string[];
      revoked: string[];
      requests: string[];
      uploads: number;
      rejectNextUpload: boolean;
      rejectNextSave: boolean;
      rejectNextObjectURL: boolean;
    };
  }
}

window.__uiReview = { created: [], revoked: [], requests: [], uploads: 0, rejectNextUpload: false, rejectNextSave: false, rejectNextObjectURL: false };
const createObjectURL = URL.createObjectURL.bind(URL);
const revokeObjectURL = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob) => {
  if (window.__uiReview.rejectNextObjectURL) {
    window.__uiReview.rejectNextObjectURL = false;
    throw new Error('Local preview failure');
  }
  const url = createObjectURL(blob);
  window.__uiReview.created.push(url);
  return url;
};
URL.revokeObjectURL = (url: string) => { window.__uiReview.revoked.push(url); revokeObjectURL(url); };

let profile: TemplateSettingsForm = {
  headerText: 'Schulamt Beispiel', returnAddress: 'Beispielweg 1 · 80000 Beispielstadt', logoUrl: '',
  contactAddress: 'Beispielweg 1\n80000 Beispielstadt', contactPerson: 'Kontakt Beispiel', city: 'Beispielstadt',
  amtsleitungName: 'Amtsleitung Beispiel', amtsleitungTitle: 'Schulamtsdirektion', signatureUrl: '/api/media/stored-signature.png',
  documentSubject: 'Vertretungseinsatz', documentIntro: 'Sie werden eingesetzt.', documentLegalText: '', documentClosing: 'Mit freundlichen Grüßen',
  latitude: 0, longitude: 0,
};

// All writes stay inside this tab. This fixture never forwards a fetch to a service.
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const method = init?.method ?? 'GET';
  window.__uiReview.requests.push(`${method} ${url.pathname}`);
  if (url.origin !== window.location.origin) return Response.json({ error: 'External request blocked' }, { status: 403 });
  if (url.pathname === '/api/schulamt/profile') {
    if (method === 'GET') return Response.json(profile);
    if (method === 'PATCH') {
      if (window.__uiReview.rejectNextSave) {
        window.__uiReview.rejectNextSave = false;
        return Response.json({ error: 'Simulierter Speicherfehler' }, { status: 503 });
      }
      const body = JSON.parse(String(init?.body));
      profile = { ...profile, ...(body.values ?? body) };
      return Response.json({ profile });
    }
  }
  if (url.pathname === '/api/upload' && method === 'POST') {
    window.__uiReview.uploads += 1;
    if (window.__uiReview.rejectNextUpload) {
      window.__uiReview.rejectNextUpload = false;
      return Response.json({ error: 'Simulierter Uploadfehler' }, { status: 400 });
    }
    const purpose = (init?.body as FormData).get('purpose');
    return Response.json({ success: true, url: `/api/media/${purpose}-${window.__uiReview.uploads}.png` });
  }
  if (url.pathname === '/api/settings') return Response.json({});
  if (url.pathname === '/api/schulamt/email-outbox') return Response.json([]);
  if (url.pathname === '/api/update-status') return Response.json({ enabled: false, currentVersion: 'test' });
  if (url.pathname === '/api/setup/status') return Response.json({ needsSetup: false });
  if (url.pathname === '/api/public/settings') return Response.json({ publicInstanceName: 'Schulamt Beispiel' });
  if (url.pathname === '/_recovery/api/capabilities') return Response.json({ available: false });
  if (url.pathname === '/api/geocode/postal-code') return Response.json({ error: 'Kartensuche im Test nicht verfügbar' }, { status: 503 });
  return Response.json({ error: `Unsupported fixture request: ${method} ${url.pathname}` }, { status: 400 });
};

function Coordinates() {
  const [position, setPosition] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  return <section aria-label="Koordinatenprüfung" className="mx-auto max-w-xl space-y-4 p-4">
    <PostalCodeLocationPicker postalCode="80000" latitude={position.lat} longitude={position.lng} onChange={(lat, lng) => setPosition({ lat, lng })} />
    <output aria-label="Gespeicherte Position">{JSON.stringify(position)}</output>
  </section>;
}

function Preview() {
  const params = new URLSearchParams(window.location.search);
  const [view, setView] = useState(params.get('view') || 'settings');
  document.documentElement.classList.toggle('dark', params.has('dark'));
  return <>
    <nav aria-label="Prüfansichten" className="flex flex-wrap gap-2 border-b p-3">
      {['settings', 'login', 'setup', 'coordinates', 'assignments'].map(name => <button key={name} className="rounded border p-2" onClick={() => setView(name)}>{name}</button>)}
    </nav>
    {view === 'settings' && <main className="mx-auto max-w-6xl p-4"><SchulamtEinstellungenPage /></main>}
    {view === 'login' && <LoginScreen />}
    {view === 'setup' && <main className="mx-auto max-w-5xl p-4"><InitialSetupWizard setupBlocked={false} setupTokenRequired={false} onCompleted={async () => {}} /></main>}
    {view === 'coordinates' && <Coordinates />}
    {view === 'assignments' && <main className="mx-auto max-w-2xl p-4"><AssignmentDayBlocks assignments={[
      { id: 'gs', teacherId: 'teacher', requestId: 'gs', date: '2099-09-14', hours: 2, lessonHours: '[1,2]', status: 'ACCEPTED', request: { ...openRequest, requestedSchoolType: 'GRUNDSCHULE', gradeLevel: 3, requiredSubject: 'Deutsch' } },
      { id: 'specialist', teacherId: 'teacher', requestId: 'specialist', date: '2099-09-14', hours: 2, lessonHours: '[3,4]', status: 'PENDING', request: { ...openRequest, requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: 'M/T', gradeLevel: 8, requiredSubject: 'Technik' } },
    ]} /></main>}
  </>;
}

createRoot(document.getElementById('root')!).render(<ToastProvider><ConfirmProvider><Preview /></ConfirmProvider></ToastProvider>);
