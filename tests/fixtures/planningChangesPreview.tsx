import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AssignModal } from '../../src/components/schulamt/dialogs/AssignModal';
import { RequestsList } from '../../src/components/schulamt/RequestsList';
import { AssignmentConfirmation } from '../../src/components/teacher/TeacherNextAssignment';
import { SchoolRequestForm } from '../../src/components/school/SchoolRequestForm';
import { Button } from '../../src/components/ui/button';
import { ToastProvider } from '../../src/components/ui/toast';
import { ConfirmProvider } from '../../src/components/ui/confirm-dialog';
import { toLocalDateInputValue } from '../../src/lib/dateKey';
import { getSchoolYearForDate } from '../../src/lib/schoolYear';
import { getOpenRequestDays } from '../../src/lib/requestDays';
import { parseUnfilledDays } from '../../src/lib/unfilledDays';
import { REQUEST_PRIORITY_OPTIONS } from '../../src/lib/requestPriority';
import type { AssignFormData, AssignmentData, RequestData, SchoolData, TeacherData } from '../../src/types/models';

// Synthetic, relative dates keep every confirmation usable when this fixture is
// opened later. The first day of the two-week example is always a future Monday.
const today = toLocalDateInputValue();
const monday = new Date(`${today}T12:00:00`);
monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
const futureDays: string[] = [];
for (const day = new Date(monday); futureDays.length < 10; day.setDate(day.getDate() + 1)) {
  if (day.getDay() > 0 && day.getDay() < 6) futureDays.push(toLocalDateInputValue(day));
}
const formatDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE');
const school: SchoolData = {
  id: 'planning-school', name: 'Grundschule Beispielstadt', address: 'Beispielweg 1',
  type: 'GRUNDSCHULE', latitude: null, longitude: null,
};
const teacher: TeacherData = {
  id: 'planning-reserve', name: 'Alexandra Beispiel', stammschuleId: school.id, stammschule: school,
  onlyStammschule: false, maxWeeklyHours: 25, isPartTime: true,
  schedule: JSON.stringify({ '1': [1, 2, 3, 4, 5] }), qualifications: 'Grundschule',
  status: 'ACTIVE', homeLat: 0, homeLng: 0, preferredType: 'GRUNDSCHULE',
  schoolYear: getSchoolYearForDate(monday), assignments: [],
};
function exampleRequest(id: string, date: string, name: string): RequestData {
  return {
    id, schoolId: school.id, school, date, priority: 'UNPLANNED_ABSENCE',
    startHour: 2, hours: 5, weeklyHours: 25, schoolType: 'GRUNDSCHULE',
    substitutedTeacher: name, qualifications: 'Grundschule', status: 'PENDING', assignments: [],
    comments: 'Erfundenes Beispiel für die lokale Vorschau.',
  };
}
const confirmationRequest = { ...exampleRequest('confirmation-series', futureDays[0], 'Zweiwöchige Vertretung'), endDate: futureDays[9] };
const initialAssignments: AssignmentData[] = futureDays.map((date, index) => ({
  id: `confirmation-${index}`, requestId: confirmationRequest.id, teacherId: teacher.id,
  date, hours: 5, status: 'PENDING', teacher, request: confirmationRequest,
}));
const makeInitialState = () => ({
  requests: [
    exampleRequest('later-request', futureDays[8], 'Späterer Bedarf'),
    { ...exampleRequest('ongoing-request', today, 'Laufender Bedarf ab heute'), isOpenEnded: true,
      urgencyNote: 'Die Aufsicht ist ohne zusätzliche Vertretung nicht gesichert.\nBitte vorrangig prüfen.' },
    exampleRequest('middle-request', futureDays[2], 'Mittlerer Bedarf'),
  ],
  assignments: initialAssignments.map(assignment => ({ ...assignment })),
  action: 'Noch keine Beispielaktion ausgeführt.',
  manualCount: 0,
  submittedReason: '',
});
let snapshot = makeInitialState();
const listeners = new Set<() => void>();
function publish(update: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...update };
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

// No fallback to the native fetch: every request stays in this tab's memory.
// Unknown routes fail visibly, so this fixture never writes to a real service.
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  if (url.origin !== window.location.origin) {
    publish({ action: 'Externer Aufruf in der lokalen Vorschau blockiert.' });
    return Response.json({ error: 'Diese Vorschau verwendet ausschließlich lokale Beispieldaten.' }, { status: 403 });
  }
  const unfilledMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/unfilled$/);
  if (unfilledMatch && ['PATCH', 'DELETE'].includes(method)) {
    const request = snapshot.requests.find(item => item.id === unfilledMatch[1]);
    if (!request || typeof body.date !== 'string') return Response.json({ error: 'Beispieltag fehlt.' }, { status: 400 });
    const history = parseUnfilledDays(request.unfilledDays);
    const now = new Date().toISOString();
    const decisions = method === 'PATCH'
      ? [...history.filter(entry => entry.date !== body.date || entry.revertedAt), { date: body.date, reason: null, decidedAt: now }]
      : history.map(entry => entry.date === body.date && !entry.revertedAt ? { ...entry, revertedAt: now } : entry);
    const updated = { ...request, unfilledDays: JSON.stringify(decisions) };
    const remaining = getOpenRequestDays(updated, updated.assignments);
    publish({
      requests: snapshot.requests.map(item => item.id === updated.id ? updated : item),
      action: `${formatDate(body.date)}: Tagesabsage ${method === 'PATCH' ? 'gespeichert' : 'zurückgenommen'}. ${remaining.length} weitere offene Tage im Planungshorizont. Keine Nachricht versandt.`,
    });
    return Response.json({ success: true });
  }
  const confirmationMatch = url.pathname.match(/^\/api\/assignments\/([^/]+)\/status$/);
  if (confirmationMatch && method === 'PATCH') {
    const ids: string[] = Array.isArray(body.assignmentIds) ? body.assignmentIds : [confirmationMatch[1]];
    const changed = snapshot.assignments.filter(item => ids.includes(item.id) && item.status === 'PENDING').length;
    publish({
      assignments: snapshot.assignments.map(item => ids.includes(item.id) ? { ...item, status: 'ACCEPTED' } : item),
      action: `${changed} Einsatztag(e) durch die Beispiel-Reserve gemeinsam bestätigt. Keine Nachricht versandt.`,
    });
    return Response.json({ confirmedCount: changed, alreadyAccepted: changed === 0 });
  }
  if (url.pathname === '/api/assign' && method === 'POST') {
    const count = Array.isArray(body.assignments) ? body.assignments.length : 0;
    publish({ manualCount: count, action: `${count} Einsatztag(e) im Schulamt gemeinsam zugewiesen${body.allowTimetableOverride ? ' – manuelle Ausnahme bestätigt' : ''}. Bestätigung der Reserve bleibt offen. Keine Nachricht versandt.` });
    return Response.json({ success: true, count }, { status: 201 });
  }
  if (url.pathname === '/api/requests' && method === 'POST') {
    const reason = REQUEST_PRIORITY_OPTIONS.find(option => option.value === body.priority);
    const created = { ...exampleRequest(`submitted-${Date.now()}`, body.date, body.substitutedTeacher), ...body,
      urgencyNote: body.hasUrgencyNote ? body.urgencyNote.trim() : null, school, assignments: [] };
    publish({
      requests: [...snapshot.requests, created], submittedReason: reason?.label ?? body.priority,
      action: `Beispielbedarf erstellt: ${reason?.label ?? body.priority}, ${formatDate(body.date)}. Nur lokal gespeichert.`,
    });
    return Response.json(created, { status: 201 });
  }
  publish({ action: `In dieser Vorschau nicht simuliert: ${method} ${url.pathname}. Kein Aufruf gesendet.` });
  return Response.json({ error: 'Diese Aktion gehört nicht zur lokalen Prüfvorschau.' }, { status: 400 });
};

function Preview() {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  const [activeId, setActiveId] = useState<string | null>('ongoing-request');
  const [query, setQuery] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignData, setAssignData] = useState<AssignFormData | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [dark, setDark] = useState(false);
  const activeRequest = state.requests.find(request => request.id === activeId) ?? null;
  const pending = state.assignments.filter(assignment => assignment.status === 'PENDING');

  const openAssignment = (days: string[], conflict: boolean) => {
    setAssignData({ teacherId: teacher.id, allowTimetableOverride: false, assignments: days.map(date => ({ date, hours: '5', selected: true, timetableConflict: conflict })) });
    setAssignOpen(true);
  };
  const submitAssignment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!assignData || isAssigning) return;
    const selected = assignData.assignments.filter(assignment => assignment.selected);
    if (!selected.length || (selected.some(assignment => assignment.timetableConflict) && !assignData.allowTimetableOverride)) return;
    setIsAssigning(true);
    try {
      const response = await fetch('/api/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: teacher.id, requestId: 'manual-series', allowTimetableOverride: assignData.allowTimetableOverride,
          assignments: selected.map(({ date, hours }) => ({ date, hours: Number(hours) })) }),
      });
      if (response.ok) setAssignOpen(false);
    } finally { setIsAssigning(false); }
  };

  return <div className={dark ? 'dark' : ''}>
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Lokale Prüfvorschau · ausschließlich erfundene Daten</p>
          <h1 className="text-2xl font-bold">Planung, Tagesabsagen und gemeinsame Bestätigung</h1>
          <p className="text-sm text-muted-foreground">Alle Aktionen bleiben in diesem Browserfenster. Es werden keine Daten gespeichert und keine E-Mails oder Push-Nachrichten versandt.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDark(!dark)}>Darstellung wechseln</Button>
            <Button variant="outline" onClick={() => { publish(makeInitialState()); setActiveId('ongoing-request'); setAssignOpen(false); }}>Beispiele zurücksetzen</Button>
          </div>
        </header>
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label="Ergebnis der lokalen Aktion">
          <p role="status" aria-live="polite" className="font-medium">{state.action}</p>
          <p className="mt-2 text-sm">Schulamt: {state.manualCount} lokal zugewiesene Tage · Reserve: {10 - pending.length} von 10 Tagen bestätigt{state.submittedReason ? ` · Letzter Vertretungsgrund: ${state.submittedReason}` : ''}</p>
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5" aria-label="Schulamt gemeinsam zuweisen">
          <h2 className="text-lg font-semibold">Schulamt: Zeitraum gemeinsam zuweisen</h2>
          <p className="text-sm text-muted-foreground">{teacher.name} · zwei Wochen vom {formatDate(futureDays[0])} bis {formatDate(futureDays[9])}. Der erste Fall nutzt einen passenden Einsatzplan. In den Ausnahmefällen arbeitet die Beispiel-Reserve regulär nur Montag, 1.–5. Stunde.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openAssignment(futureDays, false)}>Zehn Tage gemeinsam zuweisen</Button>
            <Button variant="outline" onClick={() => openAssignment(futureDays, true)}>Zehn Tage mit Ausnahme prüfen</Button>
            <Button variant="outline" onClick={() => openAssignment([futureDays[0]], true)}>Stundenabweichung 2.–6. Stunde prüfen</Button>
            <Button variant="outline" onClick={() => openAssignment([futureDays[1]], true)}>Zusätzlichen Dienstag prüfen</Button>
          </div>
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5" aria-label="Reserve gemeinsam bestätigen">
          <h2 className="text-lg font-semibold">Mobile Reserve: zehn zugewiesene Einsatztage bestätigen</h2>
          {pending[0]
            ? <AssignmentConfirmation assignment={pending[0]} assignments={state.assignments} />
            : <p role="status" className="font-medium text-emerald-700 dark:text-emerald-300">Alle zehn Einsatztage sind bestätigt.</p>}
          <div className="flex flex-wrap gap-2" aria-label="Status der zehn Einsatztage">
            {state.assignments.map(assignment => <span key={assignment.id} className={`rounded-md border px-2 py-1 text-xs ${assignment.status === 'ACCEPTED' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>{formatDate(assignment.date)} · {assignment.status === 'ACCEPTED' ? 'Bestätigt' : 'Offen'}</span>)}
          </div>
        </section>
        <section className="space-y-3" aria-label="Datumssortierung und Tagesabsagen">
          <h2 className="text-lg font-semibold">Übersicht: Datumssortierung und Tagesabsage</h2>
          <p className="text-sm text-muted-foreground">Eingangsreihenfolge der Beispieldaten: späterer Bedarf, laufender Bedarf ab heute, mittlerer Bedarf. Die Liste sortiert selbst. Beim laufenden Bedarf gilt „Keine Reserve verfügbar“ nur für den ausgewählten Tag.</p>
          <RequestsList filteredRequests={state.requests.filter(request => `${request.school.name} ${request.substitutedTeacher}`.toLowerCase().includes(query.toLowerCase()))}
            searchRequestQuery={query} setSearchRequestQuery={setQuery} activeRequest={activeRequest}
            handleMatch={request => setActiveId(activeId === request.id ? null : request.id)} candidates={[]} matching={false}
            openAssignModal={() => openAssignment(futureDays, false)}
            openManualAssignModal={() => openAssignment(activeRequest ? getOpenRequestDays(activeRequest, activeRequest.assignments).map(day => day.date) : futureDays, true)}
            isDeleting={isDeleting} setIsDeleting={setIsDeleting} loadData={() => {}} outbreakDays={new Map()} />
        </section>
        <section className="max-w-2xl space-y-3" aria-label="Neue Vertretungsgründe">
          <h2 className="text-lg font-semibold">Schule: neue Vertretungsgründe</h2>
          <SchoolRequestForm user={{ id: 'preview-school-user', email: 'school@example.invalid', role: 'SCHULE', schoolId: school.id, teacherId: null }} fetchRequests={() => {}} />
        </section>
      </div>
      <AssignModal assignModalOpen={assignOpen} setAssignModalOpen={setAssignOpen} assignData={assignData} setAssignData={setAssignData} handleAssignSubmit={submitAssignment} isAssigning={isAssigning} />
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<ToastProvider><ConfirmProvider><Preview /></ConfirmProvider></ToastProvider>);
