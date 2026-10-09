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

test('urgency notes are marked on collapsed requests and readable for every office status', () => {
  assert.doesNotMatch(render([openRequest], openRequest), /Dringlichkeitshinweis/);
  const urgencyNote = 'Die Aufsicht kann nicht sichergestellt werden.\nBitte vorrangig prüfen.';
  for (const status of ['PENDING', 'PARTIALLY_FILLED', 'FILLED', 'UNFILLED']) {
    const request = { ...openRequest, status, urgencyNote };
    assert.match(render([request]), /Dringlichkeitshinweis/);
    const expanded = render([request], request);
    assert.ok(expanded.includes(urgencyNote));
    assert.match(expanded, /Für Mobile Reserven nicht sichtbar/);
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
  assert.match(html, /Keine ausstehenden Anfragen gefunden/);
  assert.match(html, /Besetzte Bedarfe ansehen \(1\)/);
  assert.match(html, /Vollständig besetzt/);
  assert.match(html, /1\/2 bestätigt/);
  assert.match(html, /Nicht bestätigt: Alexandra Muster-Lehrkraft/);
  assert.match(html, /Zu vertreten:.*Johanna Muster-Langnamensvertretung/);
});

test('partial multiday staffing also appears below with its reserve, missing confirmation and replaced teacher', () => {
  const partial = { ...multiDayRequest, assignments: multiDayRequest.assignments.slice(0, 1) };
  const html = render([partial]);
  assert.doesNotMatch(html, /Keine ausstehenden Anfragen gefunden/);
  const assignedSection = html.slice(html.indexOf('Besetzte Bedarfe ansehen'));
  assert.match(assignedSection, /Teilweise besetzt/);
  assert.match(assignedSection, /0\/1 bestätigt/);
  assert.match(assignedSection, /Nicht bestätigt: Alexandra Muster-Lehrkraft/);
  assert.match(assignedSection, /Zu vertreten:.*Johanna Muster-Langnamensvertretung/);
});

test('a cancelled assignment reopens the multiday request and is excluded from active staffing counts', () => {
  const reopened = { ...multiDayRequest, status: 'FILLED', assignments: multiDayRequest.assignments.map((assignment, index) => index === 0 ? { ...assignment, status: 'REJECTED' } : assignment) };
  const html = render([reopened], reopened);
  assert.doesNotMatch(html, /Keine ausstehenden Anfragen gefunden/);
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
  assert.match(html, /4 von 6 offenen Std. verfügbar · Teilbesetzung möglich/);
});
