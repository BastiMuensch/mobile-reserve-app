import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { planningQuickUntil, shiftPlanningDay } from '../src/lib/planningDates';
import { mayReadSchoolOfficeMessage, schoolOfficeMessageSchema } from '../src/lib/schoolOfficeMessage';
import { createAssignmentHistoryLookup, historyDateRange, requestAssignmentHistory, type HistoryAssignment } from '../src/lib/requestAssignmentHistory';
import { RequestAssignmentHistory } from '../src/components/schulamt/RequestAssignmentHistory';
import { RequestUrgencyBadge } from '../src/components/schulamt/RequestUrgencyNote';

test('planning shortcuts include today and full weeks across month, DST and year boundaries', () => {
  assert.equal(planningQuickUntil('2026-10-30', 'today'), '2026-10-30');
  assert.equal(planningQuickUntil('2026-10-30', 'week'), '2026-11-01');
  assert.equal(planningQuickUntil('2026-10-30', 'nextWeek'), '2026-11-08');
  assert.equal(planningQuickUntil('2026-11-01', 'week'), '2026-11-01');
  assert.equal(planningQuickUntil('2026-12-31', 'nextWeek'), '2027-01-10');
  assert.equal(shiftPlanningDay('2026-10-25', 1), '2026-10-26');
});

test('private messages are readable only by their author school and its own office', () => {
  const request = { schoolId: 'school', school: { schulamtId: 'office' } };
  assert.equal(mayReadSchoolOfficeMessage({ role: 'SCHOOL', id: 'user', schoolId: 'school' }, request), true);
  assert.equal(mayReadSchoolOfficeMessage({ role: 'SCHULAMT', id: 'office' }, request), true);
  for (const user of [
    { role: 'TEACHER', id: 'office', schoolId: 'school' },
    { role: 'SCHOOL', id: 'other', schoolId: 'other-school' },
    { role: 'SCHULAMT', id: 'other-office' },
    { role: 'ADMIN', id: 'office' },
  ]) assert.equal(mayReadSchoolOfficeMessage(user, request), false);
  assert.deepEqual(schoolOfficeMessageSchema.parse({ note: '  Update  ', previousNote: null }), { note: 'Update', previousNote: null });
  assert.equal(schoolOfficeMessageSchema.safeParse({ note: 'x'.repeat(2001), previousNote: null }).success, false);
  assert.equal(schoolOfficeMessageSchema.safeParse({ note: 'Update' }).success, false, 'updates must include the previously read message');
});

test('request history includes preceding days of this week without crossing schools, sites or school years', () => {
  const request = { id: 'request', schoolId: 'school', locationId: null, className: '2a' };
  const entry: HistoryAssignment = { id: 'previous', date: '2026-11-02', teacherId: 'teacher', teacher: { name: 'Alex Beispiel' }, hours: 5, status: 'ACCEPTED', request };
  const entries: HistoryAssignment[] = [
    entry,
    { ...entry, id: 'same-class', date: '2026-11-03', request: { ...request, id: 'other-request', className: ' ２Ａ ' } },
    { ...entry, id: 'future', date: '2026-11-04' },
    { ...entry, id: 'past-year', date: '2026-08-31' },
    { ...entry, id: 'other-school', request: { ...request, schoolId: 'foreign' } },
    { ...entry, id: 'other-site', request: { ...request, locationId: 'branch' } },
    { ...entry, id: 'other-class', request: { ...request, id: 'another', className: '2b' } },
    { ...entry, id: 'cancelled', status: 'CANCELLED' },
    { ...entry, id: 'zero', hours: 0 },
  ];
  const history = requestAssignmentHistory(request, entries, '2026-11-04');
  assert.deepEqual(history.map(row => row.id), ['same-class', 'previous']);
  assert.equal(history[0].sameRequest, false);
  const html = renderToStaticMarkup(createElement(RequestAssignmentHistory, { requestId: request.id, before: '2026-11-04', initialEntries: history, className: '3a' }));
  // The person who already knows the class is the headline, not a collapsed footnote.
  assert.match(html, /Zuletzt in Klasse 3a/);
  assert.match(html, /<strong[^>]*>Alex Beispiel<\/strong><span[^>]*>2 Tage · zuletzt Di\., 03\.11\.<\/span>/);
  assert.match(html, /gleiche Klasse, anderer Bedarf/);
  assert.match(html, /Alle Einsätze ansehen \(2\)/);
});

test('school message control appears only for a message and does not imply urgency', () => {
  assert.equal(renderToStaticMarkup(createElement(RequestUrgencyBadge, { note: ' ' })), '');
  const html = renderToStaticMarkup(createElement(RequestUrgencyBadge, { note: 'Organisatorischer Hinweis' }));
  assert.match(html, /Schulnachricht öffnen/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /Dringlichkeit|bg-amber|bg-rose/);
});

test('history database windows include September 1 and exclude the deployment day across year boundaries', () => {
  for (const [before, start] of [
    ['2026-11-04', '2026-09-01'],
    ['2027-08-31', '2026-09-01'],
    ['2027-09-01', '2027-09-01'],
    ['2028-02-29', '2027-09-01'],
  ]) {
    const range = historyDateRange(before);
    assert.equal(range.gte.toISOString(), `${start}T00:00:00.000Z`);
    assert.equal(range.lt.toISOString(), `${before}T00:00:00.000Z`);
  }
  assert.throws(() => historyDateRange('2027-02-29'));
});

test('batch history index keeps normalized class and exact request histories isolated and complete', () => {
  const request = { id: 'request', schoolId: 'school', locationId: null, className: '2a' };
  const entry: HistoryAssignment = { id: 'same', date: '2026-11-02', teacherId: 'teacher', teacher: { name: 'Alex Beispiel' }, hours: 5, status: 'ACCEPTED', request };
  const assignments: HistoryAssignment[] = [
    entry,
    { ...entry, id: 'class-related', request: { ...request, id: 'other-request', className: ' ２Ａ ' } },
    { ...entry, id: 'request-before-label', request: { ...request, className: null } },
    { ...entry, id: 'past-year', date: '2026-08-31' },
    ...Array.from({ length: 1000 }, (_, index) => ({ ...entry, id: `unrelated-${index}`, request: { ...request, id: `unrelated-${index}`, schoolId: 'other-school' } })),
  ];
  const lookup = createAssignmentHistoryLookup(assignments);
  assert.deepEqual(lookup(request).map(item => item.id), ['same', 'request-before-label', 'past-year', 'class-related']);
  assert.deepEqual(requestAssignmentHistory(request, lookup(request), '2026-11-04'), requestAssignmentHistory(request, assignments, '2026-11-04'));
  assert.deepEqual(lookup({ ...request, id: 'not-found', className: null }), []);
});

test('previous teachers are listed once each, most recent first', async () => {
  const { previousTeachersFromHistory } = await import('../src/lib/requestAssignmentHistory');
  const entry = (id: string, teacherId: string, date: string, sameRequest = true) => ({ id, date, teacherId, teacherName: teacherId === 'a' ? 'Anna' : 'Ben', hours: 2, status: 'ACCEPTED', sameRequest });
  const people = previousTeachersFromHistory([entry('1', 'b', '2026-10-28', false), entry('2', 'a', '2026-10-21'), entry('3', 'a', '2026-10-22'), entry('4', 'a', '2026-10-22')]);
  assert.deepEqual(people.map(person => [person.teacherName, person.days, person.lastDate, person.onlyOtherRequests]), [['Ben', 1, '2026-10-28', true], ['Anna', 2, '2026-10-22', false]]);
});
