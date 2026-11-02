import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchoolRequestsList } from '../src/components/school/SchoolRequestsList';
import { openRequest } from './fixtures/uiRegressionData';
import { toLocalDateInputValue } from '../src/lib/dateKey';

function render(request = openRequest, loading = false, schoolOfficeMessagesEnabled = true, hasSchoolLocations = false) {
  return renderToStaticMarkup(createElement(SchoolRequestsList, {
    requests: [request], loading, schoolOfficeMessagesEnabled, hasSchoolLocations,
    handleCancel: () => { throw new Error('Rendering must not cancel a request'); },
    handleEndRequest: () => { throw new Error('Rendering must not end a request'); },
  }));
}

test('cards and tables preserve weekly hours and expose unified lifecycle and private-message actions', () => {
  const html = render();
  assert.equal((html.match(/22 Std\.\/Woche/g) || []).length, 2);
  assert.equal((html.match(/Hinweise ansehen/g) || []).length, 2);
  assert.equal((html.match(/Bedarf ändern \/ beenden/g) || []).length, 2);
  assert.equal((html.match(/Nachricht ans Schulamt/g) || []).length, 2);
  assert.match(html, /@container\/requests/);
  assert.match(html, /table-fixed/);
});

test('the message entry appears only when enabled by the Schulamt or for an existing message', () => {
  assert.equal((render(openRequest, false, false).match(/Nachricht ans Schulamt/g) || []).length, 0);
  assert.equal((render({ ...openRequest, hasSchoolOfficeMessage: true }, false, false).match(/Nachricht ans Schulamt/g) || []).length, 2);
});

test('hour reporting is offered only once a deployment day has been reached', () => {
  const teacher = { id: 't', name: 'Reserve' } as never;
  const assigned = (date: string) => ({ ...openRequest, assignments: [{ id: 'a', requestId: openRequest.id, teacherId: 't', teacher, date, hours: 4, status: 'ACCEPTED' }] });
  assert.doesNotMatch(render(assigned('2099-10-05')), /Stunden melden \/ korrigieren/);
  assert.match(render(assigned(toLocalDateInputValue())), /Stunden melden \/ korrigieren/);
});

test('cancelled deployments keep the school entry for existing hour reports', () => {
  const assignment = { id: 'a', requestId: openRequest.id, teacherId: 't', date: toLocalDateInputValue(), hours: 4, status: 'REJECTED' };
  assert.doesNotMatch(render({ ...openRequest, assignments: [assignment] }), /Stunden melden \/ korrigieren/);
  assert.match(render({ ...openRequest, assignments: [{ ...assignment, _count: { hourCorrections: 1 } }] }), /Stunden melden \/ korrigieren/);
});

test('filled and fixed requests retain the lifecycle action', () => {
  const html = render({ ...openRequest, status: 'FILLED', isOpenEnded: false });
  assert.equal((html.match(/Bedarf ändern \/ beenden/g) || []).length, 2);
});

test('future refused requests can still be withdrawn by the school', () => {
  const html = render({ ...openRequest, status: 'UNFILLED', isOpenEnded: false });
  assert.match(html, /Ohne Begründung/);
  assert.equal((html.match(/Bedarf ändern \/ beenden/g) || []).length, 2);
});

test('past requests stay in the collapsed archive; loading does not render actions', () => {
  const html = render({ ...openRequest, date: '2000-01-03', isOpenEnded: false });
  assert.match(html, /Archiv \(1 vergangene Anfrage\)/);
  assert.doesNotMatch(html, /Bedarf ändern \/ beenden/);
  const loading = render(openRequest, true);
  assert.match(loading, /Lade Anfragen/);
  assert.doesNotMatch(loading, /Bedarf ändern \/ beenden/);
});

test('an open request shows its day-specific refusal without hiding the remaining request', () => {
  const html = render({ ...openRequest, unfilledDays: JSON.stringify([{ date: '2099-10-05', reason: 'Keine Reserve verfügbar', decidedAt: '2099-10-05T06:00:00Z' }]) });
  assert.match(html, /Keine Reserve am 5\.10\.2099/);
  assert.match(html, /AUSSTEHEND/);
  assert.match(html, /Bedarf ändern \/ beenden/);
});

test('private urgency notes are not rendered as shared deployment comments', () => {
  const html = render({ ...openRequest, urgencyNote: 'Nur fürs Schulamt sichtbarer Testhinweis' });
  assert.doesNotMatch(html, /Nur fürs Schulamt sichtbarer Testhinweis/);
});


test('cancelled future requests are archived and cannot be cancelled again', () => {
  const html = render({ ...openRequest, status: 'CANCELLED' });
  assert.match(html, /Archiv/);
  assert.doesNotMatch(html, /Bedarf ändern \/ beenden/);
});

test('both layouts show the requested teaching type, grade and subject for a combined institution', () => {
  const html = render({ ...openRequest, schoolType: 'GS_MS', requestedSchoolType: 'GRUNDSCHULE', gradeLevel: 2, requiredSubject: 'Sport', qualifications: 'Grundschule' });
  assert.equal((html.match(/Jahrgangsstufe 2/g) || []).length, 2);
  assert.equal((html.match(/Fach: Sport/g) || []).length, 2);
  assert.match(html, /Benötigte Schulart/);
  assert.doesNotMatch(html, /GS\/MS|Grund- und Mittelschule/);
});

test('today remains active even when the device timezone is west of Germany', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-02T10:00:00Z') });
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const today = toLocalDateInputValue();
    const html = render({ ...openRequest, date: `${today}T00:00:00.000Z`, isOpenEnded: false });
    assert.doesNotMatch(html, /Archiv \(1 vergangene Anfrage\)/);
    assert.equal((html.match(/Bedarf ändern \/ beenden/g) || []).length, 2);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('the site line appears only for schools with additional sites', () => {
  assert.doesNotMatch(render(), /Hauptstandort/);
  assert.equal((render(openRequest, false, true, true).match(/Hauptstandort/g) || []).length, 2);
  const atSite = { ...openRequest, locationId: 'site', location: { id: 'site', name: 'Außenstelle Nord' } } as typeof openRequest;
  assert.match(render(atSite), /Außenstelle Nord/);
});

test('stored qualification lists are shown with spaces', () => {
  const html = render({ ...openRequest, qualifications: 'Deutsch,Mathematik' });
  assert.match(html, /Deutsch, Mathematik/);
  assert.doesNotMatch(html, /Deutsch,Mathematik/);
});
