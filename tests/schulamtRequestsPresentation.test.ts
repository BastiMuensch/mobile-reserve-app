import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequestsList } from '../src/components/schulamt/RequestsList';
import { ConfirmProvider } from '../src/components/ui/confirm-dialog';
import { ToastProvider } from '../src/components/ui/toast';
import { openRequest, teacher } from './fixtures/uiRegressionData';
import type { RequestData, TeacherData } from '../src/types/models';

function render(requests: RequestData[], activeRequest: RequestData | null = null, candidates: TeacherData[] = []) {
  const noop = () => {};
  return renderToStaticMarkup(createElement(ToastProvider, null,
    createElement(ConfirmProvider, null, createElement(RequestsList, {
      filteredRequests: requests, activeRequest, searchRequestQuery: '', setSearchRequestQuery: noop,
      handleMatch: noop, candidates, openAssignModal: noop, openManualAssignModal: noop,
      isDeleting: false, setIsDeleting: noop, loadData: noop, outbreakDays: new Map(),
    }))));
}

test('overview defaults to chronological request and assignment order', () => {
  const later = { ...openRequest, id: 'later', date: '2099-10-06', school: { ...openRequest.school, name: 'Later school' } };
  const earlier = { ...openRequest, id: 'earlier', date: '2099-10-05', school: { ...openRequest.school, name: 'Earlier school' } };
  const html = render([later, earlier]);
  assert.match(html, /option value="date" selected=""/);
  assert.ok(html.indexOf('Earlier school') < html.indexOf('Later school'));
  const filled = { ...earlier, status: 'FILLED', assignments: [
    { id: 'late', requestId: earlier.id, teacherId: 't2', date: '2099-10-07', hours: 3, status: 'PENDING' },
    { id: 'early', requestId: earlier.id, teacherId: 't1', date: '2099-10-05', hours: 3, status: 'ACCEPTED' },
  ] };
  const filledHtml = render([filled], filled);
  assert.ok(filledHtml.indexOf('5.10.2099 - 3h') < filledHtml.indexOf('7.10.2099 - 3h'));
});

test('ongoing requests offer individual open dates and preserve reversal for a refused day', () => {
  const ongoing = {
    ...openRequest, date: '2099-10-05', endDate: undefined, isOpenEnded: true, schedule: undefined, assignments: [],
    unfilledDays: JSON.stringify([{ date: '2099-10-05', reason: null, decidedAt: '2099-10-05T06:00:00Z' }]),
  };
  const html = render([ongoing], ongoing);
  assert.match(html, /Absage für/);
  assert.match(html, /Tage ohne Reserve/);
  assert.match(html, /Absage zurücknehmen/);
  assert.doesNotMatch(html, /option value="2099-10-05"/);
});

test('school messages have an accessible popup control for every office status', () => {
  assert.doesNotMatch(render([openRequest], openRequest), /Schulnachricht öffnen/);
  const urgencyNote = 'Die Aufsicht kann nicht sichergestellt werden.\nBitte vorrangig prüfen.';
  for (const status of ['PENDING', 'PARTIALLY_FILLED', 'FILLED', 'UNFILLED']) {
    const request = { ...openRequest, status, urgencyNote };
    assert.match(render([request]), /Schulnachricht öffnen/);
    const expanded = render([request], request);
    assert.match(expanded, /aria-label="Schulnachricht öffnen – nur für das Schulamt"/);
    assert.match(expanded, /aria-haspopup="dialog"/);
    assert.ok(!expanded.includes(urgencyNote), 'message text opens on demand instead of filling every row');
  }
});

const multiDayRequest: RequestData = {
  ...openRequest, date: '2099-10-05', endDate: '2099-10-06', schedule: undefined,
  isOpenEnded: false, status: 'PARTIALLY_FILLED',
  assignments: [
    { id: 'first-day', requestId: openRequest.id, teacherId: teacher.id, teacher, date: '2099-10-05', hours: 6, status: 'PENDING' },
    { id: 'second-day', requestId: openRequest.id, teacherId: teacher.id, teacher, date: '2099-10-06', hours: 6, status: 'ACCEPTED' },
  ],
};

test('fully staffed multiday requests leave the open list even when stored status is stale', () => {
  const html = render([multiDayRequest]);
  assert.match(html, /Keine offenen Bedarfe gefunden/);
  assert.match(html, /Besetzte Bedarfe ansehen \(1\)/);
  assert.match(html, /Vollständig besetzt/);
  assert.match(html, /1\/2 bestätigt/);
  assert.match(html, /Nicht bestätigt: Alexandra Muster-Lehrkraft/);
  assert.match(html, /Zu vertreten:.*Johanna Muster-Langnamensvertretung/);
});

test('partial multiday staffing also appears below with its reserve, missing confirmation and replaced teacher', () => {
  const partial = { ...multiDayRequest, assignments: multiDayRequest.assignments.slice(0, 1) };
  const html = render([partial]);
  assert.doesNotMatch(html, /Keine offenen Bedarfe gefunden/);
  const assignedSection = html.slice(html.indexOf('Besetzte Bedarfe ansehen'));
  assert.match(assignedSection, /Teilweise besetzt/);
  assert.match(assignedSection, /0\/1 bestätigt/);
  assert.match(assignedSection, /Nicht bestätigt: Alexandra Muster-Lehrkraft/);
  assert.match(assignedSection, /Zu vertreten:.*Johanna Muster-Langnamensvertretung/);
});

test('ended requests retain their assignment details and are explicitly labelled as ended', () => {
  const ended = { ...multiDayRequest, status: 'ENDED', endedAt: '2099-10-06T12:00:00Z' };
  const html = render([ended], ended);
  assert.match(html, /Beendet/);
  assert.doesNotMatch(html, /Teilweise besetzt|Bedarf ändern \/ beenden/);
  // Future days cannot have delivered hours yet; reached days can be reviewed.
  assert.doesNotMatch(html, /Stundenmeldungen prüfen/);
  const reached = { ...ended, assignments: ended.assignments.map(assignment => ({ ...assignment, date: '2026-10-05' })) };
  assert.match(render([reached], reached), /Stundenmeldungen prüfen/);
});

test('a cancelled assignment reopens the multiday request and is excluded from active staffing counts', () => {
  const reopened = { ...multiDayRequest, status: 'FILLED', assignments: multiDayRequest.assignments.map((assignment, index) => index === 0 ? { ...assignment, status: 'REJECTED' } : assignment) };
  const html = render([reopened], reopened);
  assert.doesNotMatch(html, /Keine offenen Bedarfe gefunden/);
  const assignedSection = html.slice(html.indexOf('Besetzte Bedarfe ansehen'));
  assert.match(assignedSection, /1\/1 bestätigt/);
  assert.doesNotMatch(assignedSection, /Storniert \(Ausfall\)/);
  assert.doesNotMatch(assignedSection, /Nicht bestätigt:/);
});

test('all suggested reserves remain visible and partial capacity is explicit', () => {
  const request = { ...multiDayRequest, endDate: undefined, status: 'PENDING', assignments: [] };
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    ...teacher, id: `candidate-${index}`, name: `Reserve ${index + 1}`,
    availableHoursByDate: { '2099-10-05': 4 },
  }));
  const html = render([request], request, candidates);
  assert.match(html, /Reserve 6/);
  assert.match(html, /4 von 6 Std\. abdeckbar/);
});

test('suggestions appear beside the selected request and immediately after its row on mobile', () => {
  const first = { ...openRequest, id: 'selected', date: '2099-10-05', school: { ...openRequest.school, name: 'Selected school' } };
  const second = { ...openRequest, id: 'other', date: '2099-10-06', school: { ...openRequest.school, name: 'Other school' } };
  const html = render([first, second], first, [{ ...teacher, name: 'Suggested teacher' }]);
  assert.ok(html.indexOf('Suggested teacher') < html.indexOf('Other school'), 'the mobile suggestion must precede the next request');
  assert.match(html, /Ausgewählter Bedarf/);
  assert.match(html, /Suggested teacher zuweisen/);
});

test('selected request context precedes the visible day refusal and collapsed supplemental details', () => {
  const request = { ...openRequest, className: '3b', substitutedTeacher: 'Anna Beispiel' };
  const html = render([request], request, [teacher]);
  const desktop = html.slice(html.indexOf('<aside aria-label="Details zum ausgewählten Bedarf"')).split('</aside>')[0];
  // The school is the headline; the substituted teacher and class follow as context.
  assert.match(desktop, /<h2[^>]*>[^<]*Grundschule[^<]*<\/h2><p[^>]*>Vertretung für Anna Beispiel · Klasse 3b<\/p>/);
  assert.ok(desktop.indexOf('Ausgewählter Bedarf') < desktop.indexOf('Tag absagen'));
  assert.ok(desktop.indexOf('Tag absagen') < desktop.indexOf('Bisherige Einsätze'));
  assert.ok(desktop.indexOf('Bisherige Einsätze') < desktop.indexOf('Bedarfsdetails &amp; weitere Aktionen'));
  assert.ok(desktop.indexOf('Bedarfsdetails &amp; weitere Aktionen') < desktop.indexOf('Lehrkräfte für diesen Bedarf'));
  assert.doesNotMatch(desktop, /<details[^>]*\sopen[=>\s]/);
});

test('expanded office details show weekly lesson slots instead of the start placeholder', () => {
  const request = {
    ...openRequest, date: '2099-10-05', endDate: '2099-10-09', startHour: 1,
    schedule: JSON.stringify({ '1': [3, 4], '2': [5, 7] }), assignments: [],
  };
  const html = render([request], request);
  assert.match(html, /Mo: 3., 4. Std. · Di: 5., 7. Std./);
  assert.doesNotMatch(html, /ab 1. (?:Std.|Unterrichtsstunde)/);
});

test('expanded office details retain the stated start for a daily request', () => {
  const request = { ...openRequest, date: '2099-10-05', schedule: undefined, startHour: 4 };
  assert.match(render([request], request), /ab 4. Std./);
});

test('office demand details retain explicit grade and subject requirements', () => {
  const request = { ...openRequest, requestedSchoolType: 'GRUNDSCHULE', gradeLevel: 2, requiredSubject: 'Sport' };
  const html = render([request], request);
  assert.match(html, /Jahrgangsstufe 2 · Fach: Sport/);
});

test('cancelled assignment history has a neutral label and cannot be cancelled again', () => {
  const request = { ...openRequest, assignments: [{ id: 'cancelled-history', teacherId: teacher.id, requestId: openRequest.id, teacher, date: openRequest.date, hours: 4, status: 'REJECTED' }] };
  const html = render([request], request);
  assert.match(html, /Storniert/);
  assert.doesNotMatch(html, /Storniert \(Ausfall\)|title="Zuweisung aufheben"/);
});

test('ended and cancelled demands keep reviewed hour reports reachable in office history', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-02T10:00:00Z') });
  for (const status of ['ENDED', 'CANCELLED']) {
    const request = { ...openRequest, status, date: '2026-10-20', endDate: '2026-10-20', isOpenEnded: false,
      assignments: [{ id: 'reviewed-cancellation', teacherId: teacher.id, requestId: openRequest.id, teacher,
        date: '2026-11-01', hours: 4, status: 'REJECTED', _count: { hourCorrections: 1 } }] };
    const html = render([request], request);
    assert.match(html, /Stundenmeldungen prüfen/);
    assert.match(html, /Storniert/);
    assert.doesNotMatch(html, /0\/0 bestätigt|Nicht bestätigt:|title="Zuweisung aufheben"/);
    assert.doesNotMatch(render([{ ...request, assignments: [{ ...request.assignments[0], _count: { hourCorrections: 0 } }] }]), /Besetzter Bedarf/);
  }
});

test('office assignment rows retain the German calendar day on a western device timezone', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-02T10:00:00Z') });
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const request = { ...openRequest, date: '2026-11-09', isOpenEnded: false, schedule: undefined, assignments: [{ id: 'november-day', teacherId: teacher.id, requestId: openRequest.id, teacher, date: '2026-11-09T00:00:00.000Z', hours: 2, status: 'ACCEPTED' }] };
    const html = render([request], request);
    assert.match(html, /Mo\.?, 9\.11\.2026 - 2h/);
    assert.doesNotMatch(html, /8\.11\.2026 - 2h/);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('request cards distinguish teachers and classes at the same school before expansion', () => {
  const first = { ...openRequest, id: 'first-teacher', className: '1a', substitutedTeacher: 'Anna Beispiel' };
  const second = { ...openRequest, id: 'second-teacher', className: '4c', substitutedTeacher: 'Ben Beispiel' };
  const html = render([first, second]);
  assert.match(html, /aria-label="Bedarf für Anna Beispiel, Klasse 1a an/);
  assert.match(html, /aria-label="Bedarf für Ben Beispiel, Klasse 4c an/);
  assert.match(html, /Vertretung für Anna Beispiel · Klasse 1a/);
  assert.match(html, /Vertretung für Ben Beispiel · Klasse 4c/);
});

test('overview offers a separate archive and hides older staffed and refused entries by default', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T10:00:00Z') });
  const oldFilled = {
    ...multiDayRequest, id: 'old-filled', date: '2026-10-01', endDate: undefined,
    school: { ...openRequest.school, name: 'Archivierte besetzte Schule' },
    assignments: [{ ...multiDayRequest.assignments[0], date: '2026-10-01' }],
  };
  const oldUnfilled = {
    ...openRequest, id: 'old-unfilled', date: '2026-10-01', isOpenEnded: false,
    schedule: undefined, status: 'UNFILLED',
    school: { ...openRequest.school, name: 'Archivierte unbesetzte Schule' },
  };
  const recentUnfilled = { ...oldUnfilled, id: 'recent-unfilled', date: '2026-10-09', school: { ...openRequest.school, name: 'Aktuelle unbesetzte Schule' } };
  const html = render([oldFilled, oldUnfilled, recentUnfilled]);
  assert.match(html, /Aktuell &amp; letzte 7 Tage/);
  assert.match(html, /Archiv \(2\)/);
  assert.doesNotMatch(html, /Archivierte besetzte Schule|Archivierte unbesetzte Schule/);
  assert.match(html, /Aktuelle unbesetzte Schule/);
  assert.match(html, /Tage ohne Reserve \(1\)/);
});

test('single-day demands show their day instead of "Ab …"; ongoing demands keep "Ab"', () => {
  const single = { ...openRequest, id: 'single', isOpenEnded: false, schedule: undefined, endDate: undefined };
  const singleHtml = render([single], single);
  assert.doesNotMatch(singleHtml, />Ab 1?4\.0?9\./);
  assert.match(singleHtml, /Mo\., 14\.09\./);
  assert.match(render([openRequest]), /Ab 14\.09\./);
});

test('a reserve who was already deployed in the class is highlighted among the candidates', async () => {
  const { RequestCandidates } = await import('../src/components/schulamt/RequestCandidates');
  const request = { ...openRequest, className: '3a' };
  const other = { ...teacher, id: 'other-reserve', name: 'Neue Reserve' };
  const html = renderToStaticMarkup(createElement(RequestCandidates, {
    request, candidates: [other, teacher], matching: false, onAssign: () => {}, onManualAssign: () => {},
    previousTeachers: [{ teacherId: teacher.id, teacherName: teacher.name, days: 3, lastDate: '2099-09-10', onlyOtherRequests: true }],
  }));
  assert.equal((html.match(/War in Klasse 3a · zuletzt/g) || []).length, 1);
  assert.ok(html.indexOf('War in Klasse 3a') > html.indexOf(teacher.name), 'badge belongs to the previous reserve');
});
