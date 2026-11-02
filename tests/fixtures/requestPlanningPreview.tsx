import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { SchoolOfficeMessageEditor } from '../../src/components/school/SchoolOfficeMessageEditor';
import { AssignmentHoursPanel } from '../../src/components/requests/AssignmentHoursPanel';
import { hourCorrectionSchema, hourReviewSchema, type AssignmentHoursData } from '../../src/lib/assignmentHours';
import { shiftPlanningDay } from '../../src/lib/planningDates';
import type { AssignmentHistoryEntry } from '../../src/lib/requestAssignmentHistory';
import { BatchAssignView } from '../../src/components/schulamt/BatchAssignView';
import { RequestsList } from '../../src/components/schulamt/RequestsList';
import { Button } from '../../src/components/ui/button';
import { ToastProvider } from '../../src/components/ui/toast';
import { ConfirmProvider } from '../../src/components/ui/confirm-dialog';
import { toLocalDateInputValue } from '../../src/lib/dateKey';
import { getSchoolYearForDate } from '../../src/lib/schoolYear';
import type { RequestData, SchoolData, TeacherData } from '../../src/types/models';

// Real components with synthetic requests and a closed, in-memory API. There is
// deliberately no native-fetch fallback, including for unknown URLs.
const monday = new Date();
monday.setHours(12, 0, 0, 0);
monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
const days = Array.from({ length: 5 }, (_, index) => {
  const date = new Date(monday);
  date.setDate(monday.getDate() + index);
  return toLocalDateInputValue(date);
});
const schoolYear = getSchoolYearForDate(monday);
const today = toLocalDateInputValue();
const school: SchoolData = {
  id: 'request-planning-school',
  name: 'Edith-Stein-Schule, Grundschule Beispielstadt',
  address: 'Beispielweg 1',
  type: 'GRUNDSCHULE',
  latitude: null,
  longitude: null,
};
const schedule = JSON.stringify({ '1': [1, 2, 3, 4, 5], '2': [1, 2, 3, 4, 5], '3': [2, 3, 4], '4': [1, 2, 3, 4], '5': [1, 2, 3, 4, 5, 6] });
const makeRequest = (id: string, substitutedTeacher: string, priority: string, overrides: Partial<RequestData> = {}): RequestData => ({
  id, substitutedTeacher, priority, school, schoolId: school.id, schoolType: 'GRUNDSCHULE',
  date: days[0], endDate: days[4], startHour: 1, hours: 5, weeklyHours: 23, schedule,
  qualifications: 'Grundschule', requestedSchoolType: 'GRUNDSCHULE', gradeLevel: 3, status: 'PENDING', assignments: [], className: '3a',
  ...overrides,
});
const existingTeacher: TeacherData = {
  id: 'reserve-existing', name: 'Robin Bereitszugewiesen', stammschuleId: school.id, stammschule: school,
  onlyStammschule: false, maxWeeklyHours: 28, isPartTime: false,
  qualifications: 'Grundschule', status: 'ACTIVE', homeLat: 0, homeLng: 0,
  preferredType: 'GRUNDSCHULE', schoolYear, assignments: [],
};
const historyEntries: AssignmentHistoryEntry[] = [
  { id: 'history-2', date: shiftPlanningDay(days[0], -3), teacherId: existingTeacher.id, teacherName: existingTeacher.name, hours: 4, status: 'ACCEPTED', sameRequest: true },
  { id: 'history-1', date: shiftPlanningDay(days[0], -4), teacherId: 'teacher-prior', teacherName: 'Alexandra Früherevertretung', hours: 5, status: 'ACCEPTED', sameRequest: false },
];
const initialHourAssignments: (AssignmentHoursData & { requestId: string })[] = [
  {
    id: 'hours-awaiting-review', requestId: 'request-anja', date: shiftPlanningDay(today, -1), hours: 4,
    actualHours: null, actualAdditionalMinutes: null, status: 'ACCEPTED', teacher: { name: existingTeacher.name },
    hourCorrections: [{
      id: 'correction-awaiting-review', plannedHours: 4, previousActualHours: null, previousAdditionalMinutes: null,
      proposedHours: 5, additionalMinutes: 30, additionalTasks: 'Betreuung einer Lerngruppe nach dem Unterricht.',
      reason: 'Zusätzliche Vertretungsstunde und weitere Betreuung übernommen.', status: 'PENDING',
      createdAt: new Date().toISOString(), reviewedAt: null, reviewNote: null,
    }],
  },
  {
    id: 'hours-school-entry', requestId: 'request-anja', date: shiftPlanningDay(today, -2), hours: 5,
    actualHours: null, actualAdditionalMinutes: null, status: 'ACCEPTED', teacher: { name: existingTeacher.name }, hourCorrections: [],
  },
];
const initialRequests = [
  makeRequest('request-anja', 'Anja Beispiel', 'UNPLANNED_ABSENCE', {
    endDate: undefined, isOpenEnded: true,
    assignments: [{ id: 'already-assigned-monday', requestId: 'request-anja', teacherId: existingTeacher.id, teacher: existingTeacher, date: days[0], hours: 3, status: 'ACCEPTED' }],
    urgencyNote: 'Die Aufsicht ist ohne Vertretung nicht gesichert. Bitte vorrangig prüfen.',
  }),
  makeRequest('request-abdullah', 'Abdullah Beispiel', 'FORTBILDUNG', { className: '1b' }),
  makeRequest('request-gerda', 'Gerda Nichtbesetzbar', 'DIENSTBEFREIUNG', {
    date: days[1], endDate: days[3], className: '4c',
    schedule: JSON.stringify({ '2': [2, 3, 4, 5, 6], '4': [3, 4, 5, 6] }),
    weeklyHours: 9, startHour: 2,
  }),
];
const additionalSchools: SchoolData[] = [
  { ...school, id: 'request-planning-school-2', name: 'Grund- und Mittelschule Beispielhausen' },
  { ...school, id: 'request-planning-school-3', name: 'Theodor-Heuss-Schule, Grundschule Musterstadt' },
];
const denseRequests = ['Lena Sommer', 'Michael Winter', 'Julia Neumann', 'Emil Huber', 'Clara Lang', 'Lukas Wald', 'Sarah Winkler', 'Paul Meier', 'Mara Wolf'].map((name, index) => {
  const requestSchool = index < 3 ? school : additionalSchools[index < 6 ? 0 : 1];
  return makeRequest(`request-dense-${index}`, name, index % 2 ? 'FORTBILDUNG' : 'UNPLANNED_ABSENCE', {
    school: requestSchool, schoolId: requestSchool.id, className: `${index % 4 + 1}${index % 2 ? 'b' : 'a'}`,
    ...(index === 0 ? { unfilledDays: JSON.stringify([{ date: days[1], reason: 'Bereits entschiedener Beispieltag', decidedAt: new Date().toISOString() }]) } : {}),
  });
});
const teachers: TeacherData[] = [{
  id: 'reserve-noah', name: 'Noah Beispiel', stammschuleId: school.id, stammschule: school,
  onlyStammschule: false, maxWeeklyHours: 28, isPartTime: false,
  qualifications: 'Grundschule', status: 'ACTIVE', homeLat: 0, homeLng: 0,
  preferredType: 'GRUNDSCHULE', schoolYear, assignments: [], distanceToSchool: 1.2,
  matchScore: 545,
  assignedHours: 0,
}];
type Call = { method: string; path: string; body: Record<string, unknown>; failed?: boolean };
type RetainedItem = { requestId: string; segments: { teacherId: string; entries: { date: string; hours: number }[] }[] };
const makeInitialState = () => ({
  requests: structuredClone(initialRequests),
  hourAssignments: structuredClone(initialHourAssignments),
  calls: [] as Call[],
  failNextRejection: false,
  failNextPreview: false,
  staleNextPreview: false,
  staleNextApproval: false,
  dense: false,
  action: 'Noch keine Beispielaktion ausgeführt.',
  resetKey: 0,
});
let snapshot = makeInitialState();
const listeners = new Set<() => void>();
function publish(update: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...update };
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function preview(body: Record<string, unknown>) {
  const selectedSchoolYear = typeof body.schoolYear === 'string' ? body.schoolYear : schoolYear;
  const yearStart = `${selectedSchoolYear.split('/')[0]}-09-01`;
  const from = today > yearStart ? today : yearStart;
  const until = typeof body.until === 'string' ? body.until : days[3];
  const retainedItems = Array.isArray(body.retainedItems) ? body.retainedItems as RetainedItem[] : [];
  const excludedRequestIds = Array.isArray(body.excludedRequestIds) ? body.excludedRequestIds as string[] : [];
  const excluded = new Set(excludedRequestIds);
  const retained = new Map(retainedItems.map(item => [item.requestId, item]));
  const retainedTeacherDays = new Set(retainedItems.flatMap(item => item.segments.flatMap(segment => segment.entries.map(entry => `${segment.teacherId}:${entry.date}`))));
  const names: Record<string, string> = {
    'reserve-noah': 'Noah Beispiel', 'reserve-anna': 'Anna-Veronica Beispiel',
    'reserve-alternative-0': 'Theresa Alternative', 'reserve-alternative-1': 'Maria Alternative',
  };
  const openDays = (request: RequestData) => {
    const refused = new Set((JSON.parse(request.unfilledDays || '[]') as { date: string }[]).map(day => day.date));
    const daily: Record<string, number[]> = JSON.parse(request.schedule || '{}');
    // Planning scope deliberately excludes Monday and Friday of the full request.
    return days.slice(1, 4).flatMap((date, index) => {
      if (date < from || date > until || date < request.date || (request.endDate && date > request.endDate)) return [];
      const lessonHours = daily[String(index + 2)] || [];
      const assignedHours = request.assignments.filter(assignment => assignment.date === date && assignment.status !== 'REJECTED').reduce((sum, assignment) => sum + assignment.hours, 0);
      const hours = Math.max(0, lessonHours.length - assignedHours);
      return hours && !refused.has(date) ? [{ date, hours, lessonHours }] : [];
    });
  };
  const requestsById = Object.fromEntries(snapshot.requests.map(request => {
    const requestDays = openDays(request);
    const historyBefore = requestDays[0]?.date ?? from;
    return [request.id, { ...request, openDays: requestDays, historyBefore, assignmentHistory: request.className === '3a' ? historyEntries.filter(entry => entry.date < historyBefore) : [] }];
  }));
  const canReallocateAnna = excluded.has('request-abdullah');
  const proposals = snapshot.requests.flatMap((request, index) => {
    if (excluded.has(request.id) || (request.id === 'request-gerda' && !canReallocateAnna && !retained.has(request.id))) return [];
    const entries = openDays(request);
    if (!entries.length) return [];
    const requiredHours = entries.reduce((sum, entry) => sum + entry.hours, 0);
    const retainedItem = retained.get(request.id);
    const defaultTeacherId = index === 0 ? teachers[0].id : index < 3 ? 'reserve-anna' : `reserve-dense-${index}`;
    if (!retainedItem && entries.some(entry => retainedTeacherDays.has(`${defaultTeacherId}:${entry.date}`))) return [];
    const segments = retainedItem ? retainedItem.segments.map(segment => ({
      ...segment,
      teacherName: names[segment.teacherId] || `Reserve für ${request.substitutedTeacher}`,
      score: 545, reasons: ['Auswahl beibehalten'], warnings: [], alternatives: [],
    })) : [{
      teacherId: defaultTeacherId,
      teacherName: names[defaultTeacherId] || `Reserve für ${request.substitutedTeacher}`,
      entries, score: 545 - index * 10, reasons: ['Qualifikation passt'], warnings: [],
      alternatives: index < 2 ? [{ teacherId: `reserve-alternative-${index}`, name: index ? 'Maria Alternative' : 'Theresa Alternative', score: 200, reasons: ['Grundschule'] }] : [],
    }];
    return [{
      requestId: request.id, coverage: { assignedHours: requiredHours, requiredHours },
      urgency: { score: 100 - index, reasons: index ? [] : ['Ungeplanter Ausfall'] },
      segments,
    }];
  });
  const proposedIds = new Set(proposals.map(proposal => proposal.requestId));
  const unfillable = snapshot.requests.filter(request => !proposedIds.has(request.id) && openDays(request).length).map(request => ({
    requestId: request.id,
    reason: excluded.has(request.id) ? 'Für diese Berechnung zurückgestellt.' : 'Keine passende Lehrkraft verfügbar (Qualifikation, Schulart, Stundenplan oder Abwesenheit).',
  }));
  return {
    reserveShortageMode: false,
    schools: [school, ...(snapshot.dense ? additionalSchools : [])].filter(requestSchool => snapshot.requests.some(request => request.schoolId === requestSchool.id && openDays(request).length > 0)).map(requestSchool => {
      const schoolProposals = proposals.filter(proposal => requestsById[proposal.requestId].schoolId === requestSchool.id);
      const schoolUnfillable = unfillable.filter(entry => requestsById[entry.requestId].schoolId === requestSchool.id);
      return {
      schoolId: requestSchool.id, schoolName: requestSchool.name, proposals: schoolProposals, unfillable: schoolUnfillable,
      coverage: {
        filledRequests: schoolProposals.length, totalRequests: schoolProposals.length + schoolUnfillable.length,
        assignedHours: schoolProposals.reduce((sum, proposal) => sum + proposal.coverage.assignedHours, 0),
        requiredHours: Object.values(requestsById).filter(request => request.schoolId === requestSchool.id).flatMap(request => request.openDays).reduce((sum, day) => sum + day.hours, 0),
      },
    }; }),
    requestsById, generatedAt: new Date().toISOString(), from, until, schoolYear: selectedSchoolYear,
    retainedRequestIds: retainedItems.map(item => item.requestId), excludedRequestIds,
  };
}

window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const body: Record<string, unknown> = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const call: Call = { method, path: url.pathname, body };
  if (url.origin !== location.origin) return Response.json({ error: 'Externer Aufruf in der Prüfvorschau gesperrt.' }, { status: 403 });
  if (url.pathname === '/api/hour-corrections' && method === 'GET') {
    const requests = snapshot.requests.flatMap(request => {
      const assignments = snapshot.hourAssignments.filter(assignment => assignment.requestId === request.id && assignment.hourCorrections.some(correction => correction.status === 'PENDING'));
      return assignments.length ? [{ id: request.id, substitutedTeacher: request.substitutedTeacher, school: { name: request.school.name }, assignments: assignments.map(assignment => ({ id: assignment.id, date: assignment.date, teacher: assignment.teacher })) }] : [];
    });
    return Response.json({ requests, total: requests.length });
  }
  const historyMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/history$/);
  if (historyMatch && method === 'GET') return Response.json({ entries: snapshot.requests.find(request => request.id === historyMatch[1])?.className === '3a' ? historyEntries : [], before: url.searchParams.get('before') });
  const messageMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/message$/);
  if (messageMatch) {
    const request = snapshot.requests.find(item => item.id === messageMatch[1]);
    if (!request) return Response.json({ error: 'Beispielbedarf fehlt.' }, { status: 404 });
    if (method === 'GET') return Response.json({ note: request.urgencyNote ?? null, enabled: true });
    if (method === 'PATCH') {
      if (body.previousNote !== (request.urgencyNote ?? null)) return Response.json({ error: 'Nachricht inzwischen geändert.' }, { status: 409 });
      const note = String(body.note || '').trim() || null;
      publish({ calls: [...snapshot.calls, call], requests: snapshot.requests.map(item => item.id === request.id ? { ...item, urgencyNote: note } : item), action: 'Schulnachricht lokal gespeichert.' });
      return Response.json({ note, enabled: true });
    }
  }
  const hoursMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/hours$/);
  if (hoursMatch && method === 'GET') return Response.json({ assignments: snapshot.hourAssignments.filter(assignment => assignment.requestId === hoursMatch[1]) });
  const reportHoursMatch = url.pathname.match(/^\/api\/assignments\/([^/]+)\/hours$/);
  if (reportHoursMatch && method === 'POST') {
    const parsed = hourCorrectionSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const assignment = snapshot.hourAssignments.find(entry => entry.id === reportHoursMatch[1]);
    if (!assignment) return Response.json({ error: 'Beispieleinsatz fehlt.' }, { status: 404 });
    if (assignment.hourCorrections.some(correction => correction.status === 'PENDING')) return Response.json({ error: 'Für diesen Tag liegt bereits eine offene Meldung vor.' }, { status: 409 });
    const correction = {
      id: `correction-${Date.now()}`, plannedHours: assignment.hours,
      previousActualHours: assignment.actualHours, previousAdditionalMinutes: assignment.actualAdditionalMinutes,
      ...parsed.data, status: 'PENDING', createdAt: new Date().toISOString(), reviewedAt: null, reviewNote: null,
    };
    publish({
      calls: [...snapshot.calls, call],
      hourAssignments: snapshot.hourAssignments.map(entry => entry.id === assignment.id ? { ...entry, hourCorrections: [correction, ...entry.hourCorrections] } : entry),
      action: 'Stundenmeldung lokal zur Prüfung eingereicht. Keine Nachricht versandt.',
    });
    window.dispatchEvent(new Event('app-refresh'));
    return Response.json({ correction }, { status: 201 });
  }
  const reviewHoursMatch = url.pathname.match(/^\/api\/hour-corrections\/([^/]+)$/);
  if (reviewHoursMatch && method === 'PATCH') {
    const parsed = hourReviewSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const assignment = snapshot.hourAssignments.find(entry => entry.hourCorrections.some(correction => correction.id === reviewHoursMatch[1]));
    const correction = assignment?.hourCorrections.find(entry => entry.id === reviewHoursMatch[1]);
    if (!assignment || !correction) return Response.json({ error: 'Beispielmeldung fehlt.' }, { status: 404 });
    if (correction.status !== 'PENDING') return Response.json({ error: 'Die Meldung wurde bereits geprüft.' }, { status: 409 });
    publish({
      calls: [...snapshot.calls, call],
      hourAssignments: snapshot.hourAssignments.map(entry => entry.id === assignment.id ? {
        ...entry,
        ...(parsed.data.decision === 'APPROVED' ? { actualHours: correction.proposedHours, actualAdditionalMinutes: correction.additionalMinutes } : {}),
        hourCorrections: entry.hourCorrections.map(item => item.id === correction.id ? { ...item, status: parsed.data.decision, reviewedAt: new Date().toISOString(), reviewNote: parsed.data.reviewNote || null } : item),
      } : entry),
      action: parsed.data.decision === 'APPROVED' ? 'Stundenmeldung lokal bestätigt. Geplante Stunden bleiben erhalten.' : 'Stundenmeldung lokal abgelehnt.',
    });
    window.dispatchEvent(new Event('app-refresh'));
    return Response.json({ success: true });
  }
  const lifecycleMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/end$/);
  if (lifecycleMatch && method === 'PATCH') {
    publish({ calls: [...snapshot.calls, call], action: body.action === 'CANCEL' ? 'Verbleibender Beispielbedarf lokal storniert.' : `Beispiel-Rückkehr zum ${body.lastDay} gespeichert.` });
    return Response.json({ cancelledAssignments: 3 });
  }
  if (url.pathname === '/api/batch-assign/preview' && method === 'POST') {
    if (snapshot.staleNextPreview) {
      publish({ calls: [...snapshot.calls, { ...call, failed: true }], staleNextPreview: false, action: 'Auswahlkonflikt simuliert. Vorhandene Auswahl bleibt bestehen.' });
      return Response.json({ code: 'RETAINED_SELECTION_STALE', error: 'Testkonflikt: Beibehaltene Auswahl muss geprüft werden.' }, { status: 409 });
    }
    if (snapshot.failNextPreview) {
      publish({ calls: [...snapshot.calls, { ...call, failed: true }], failNextPreview: false, action: 'Neuberechnung absichtlich fehlgeschlagen. Vorhandene Auswahl bleibt bestehen.' });
      return Response.json({ error: 'Testfehler: Neuberechnung konnte nicht durchgeführt werden.' }, { status: 503 });
    }
    publish({ calls: [...snapshot.calls, call], action: Array.isArray(body.retainedItems) && body.retainedItems.length
      ? 'Auswahl beibehalten und freie Reserven neu verteilt. Nur lokale Beispieldaten.'
      : 'Besetzungsvorschläge lokal berechnet. Keine Daten gespeichert.' });
    return Response.json(preview(body));
  }
  if (url.pathname === '/api/batch-assign/approve' && method === 'POST') {
    if (snapshot.staleNextApproval) {
      publish({ calls: [...snapshot.calls, { ...call, failed: true }], staleNextApproval: false, action: 'Freigabekonflikt simuliert. Keine Zuweisung gespeichert.' });
      return Response.json({ error: 'Testkonflikt: Freigabe benötigt einen aktuellen Vorschlag.' }, { status: 409 });
    }
    const items = Array.isArray(body.items) ? body.items as RetainedItem[] : [];
    publish({
      calls: [...snapshot.calls, call], action: 'Ausgewählte Anforderungen lokal freigegeben. Keine Nachricht versandt.',
      requests: snapshot.requests.map(request => {
        const approved = items.find(item => item.requestId === request.id);
        return approved ? { ...request, assignments: [...request.assignments, ...approved.segments.flatMap(segment => segment.entries.map(entry => ({
          id: `approved-${request.id}-${entry.date}`, requestId: request.id, teacherId: segment.teacherId,
          date: entry.date, hours: entry.hours, status: 'PENDING',
        })))] } : request;
      }),
    });
    return Response.json({ success: true, requests: items.length, assignments: items.flatMap(item => item.segments.flatMap(segment => segment.entries)).length }, { status: 201 });
  }
  const unfilled = url.pathname.match(/^\/api\/requests\/([^/]+)\/unfilled$/);
  if (unfilled && method === 'PATCH') {
    if (snapshot.failNextRejection) {
      publish({ calls: [...snapshot.calls, { ...call, failed: true }], failNextRejection: false, action: 'Absage absichtlich fehlgeschlagen. Keine Daten geändert.' });
      return Response.json({ error: 'Testfehler: Absage konnte nicht gespeichert werden.' }, { status: 503 });
    }
    const dates = Array.isArray(body.dates) ? body.dates as string[] : typeof body.date === 'string' ? [body.date] : [];
    if (!dates.length) return Response.json({ error: 'Explizite Absagetage fehlen in der Prüfvorschau.' }, { status: 400 });
    const request = snapshot.requests.find(item => item.id === unfilled[1]);
    if (!request) return Response.json({ error: 'Beispielanforderung unbekannt.' }, { status: 404 });
    const history = JSON.parse(request.unfilledDays || '[]') as { date: string; reason: string | null; decidedAt: string }[];
    const updated = {
      ...request,
      unfilledDays: JSON.stringify([...history.filter(day => !dates.includes(day.date)), ...dates.map(date => ({
        date, reason: typeof body.reason === 'string' ? body.reason : null, decidedAt: new Date().toISOString(),
      }))]),
    };
    publish({
      calls: [...snapshot.calls, call],
      requests: snapshot.requests.map(item => item.id === updated.id ? updated : item),
      action: `${request.substitutedTeacher}: ${dates.length} Tag(e) lokal abgesagt. Keine Nachricht versandt.`,
    });
    return Response.json({ success: true, dates, count: dates.length });
  }
  publish({ calls: [...snapshot.calls, call], action: `Nicht simuliert: ${method} ${url.pathname}. Kein Aufruf gesendet.` });
  return Response.json({ error: 'Diese Aktion gehört nicht zur lokalen Prüfvorschau.' }, { status: 400 });
};

function Preview() {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  const [tab, setTab] = useState('overview');
  const [activeId, setActiveId] = useState<string | null>('request-anja');
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [dark, setDark] = useState(false);
  return <div className={dark ? 'dark' : ''}>
    <main className="min-h-screen bg-background p-3 text-foreground sm:p-7">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Lokale Prüfvorschau · ausschließlich erfundene Daten</p>
          <h1 className="text-2xl font-bold">Bedarfsübersicht & Besetzungsvorschläge</h1>
          <nav aria-label="Bereich der Vorschau" className="flex flex-wrap gap-2">
            <Button variant={tab === 'overview' ? 'default' : 'outline'} onClick={() => setTab('overview')}>Bedarfsübersicht</Button>
            <Button variant={tab === 'batch' ? 'default' : 'outline'} onClick={() => setTab('batch')}>Besetzungsvorschläge prüfen</Button>
          </nav>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Prüfoptionen</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDark(!dark)}>Darstellung wechseln</Button>
              <Button variant="outline" onClick={() => publish({ ...makeInitialState(), resetKey: state.resetKey + 1 })}>Beispiele zurücksetzen</Button>
              <Button variant="outline" onClick={() => publish({
                ...makeInitialState(), dense: !state.dense,
                requests: structuredClone([...initialRequests, ...(state.dense ? [] : denseRequests)]),
                resetKey: state.resetKey + 1,
              })}>{state.dense ? 'Drei Bedarfe anzeigen' : 'Zwölf Bedarfe anzeigen'}</Button>
              {tab === 'batch' && <>
                <Button variant="outline" onClick={() => publish({ failNextRejection: true })}>Nächste Absage fehlschlagen lassen</Button>
                <Button variant="outline" onClick={() => publish({ failNextPreview: true })}>Nächste Neuberechnung fehlschlagen lassen</Button>
                <Button variant="outline" onClick={() => publish({ staleNextPreview: true })}>Nächste Neuberechnung mit Konflikt ablehnen</Button>
                <Button variant="outline" onClick={() => publish({ staleNextApproval: true })}>Nächste Freigabe mit Konflikt ablehnen</Button>
              </>}
            </div>
          </details>
          <p role="status" className="text-sm text-muted-foreground">{state.action}</p>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"><span>Ansicht der meldenden Schule:</span><SchoolOfficeMessageEditor requestId="request-anja" /><AssignmentHoursPanel requestId="request-anja" role="SCHOOL" /></div>
        </header>
        <pre hidden data-testid="fixture-state">{JSON.stringify({ calls: state.calls, days, schoolYear, requests: state.requests, dense: state.dense })}</pre>
        {tab === 'overview'
          ? <RequestsList
              filteredRequests={state.requests.filter(request => `${request.school.name} ${request.substitutedTeacher} ${request.className}`.toLowerCase().includes(query.toLowerCase()))} searchRequestQuery={query} setSearchRequestQuery={setQuery}
              activeRequest={state.requests.find(request => request.id === activeId) ?? null}
              handleMatch={request => setActiveId(current => current === request.id ? null : request.id)}
              candidates={teachers} openAssignModal={() => {}} openManualAssignModal={() => {}}
              isDeleting={deleting} setIsDeleting={setDeleting} loadData={() => {}}
              outbreakDays={new Map()}
            />
          : <BatchAssignView key={state.resetKey} schoolYear={schoolYear} />}
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<ToastProvider><ConfirmProvider><Preview /></ConfirmProvider></ToastProvider>);
