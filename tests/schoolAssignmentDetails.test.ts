import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchoolAssignmentDetails } from '../src/components/school/SchoolRequestsList';
import { openRequest, teacher } from './fixtures/uiRegressionData';
import type { AssignmentData, TeacherData } from '../src/types/models';

const assignment: AssignmentData = {
  id: 'school-assignment', requestId: openRequest.id, teacherId: teacher.id,
  date: '2026-10-20T00:00:00Z', hours: 3, lessonHours: '[6,3,4]', status: 'PENDING',
  request: { ...openRequest, startHour: 1, schedule: '{"2":[1,2,3,4,5,6]}' },
};

function render(entries = [assignment], person: TeacherData | undefined = teacher) {
  return renderToStaticMarkup(createElement(SchoolAssignmentDetails, { teacher: person, entries }));
}

test('school details show assigned lessons with gaps, per-day confirmation and cancelled remaining demand', () => {
  const html = render([
    { ...assignment, id: 'later', date: '2026-10-21', hours: 2, lessonHours: '[2,5]', status: 'ACCEPTED', cancelledHours: 2 },
    assignment,
    { ...assignment, id: 'rejected', lessonHours: '[7,8,9]', status: 'REJECTED' },
    { ...assignment, id: 'cancelled', lessonHours: '[7,8,9]', status: 'CANCELLED' },
  ]);
  assert.match(html, /3\., 4\., 6\. Stunde/);
  assert.match(html, /2\., 5\. Stunde/);
  assert.doesNotMatch(html, /7\., 8\., 9\. Stunde|ab 1\.|1\. Stunde/);
  assert.match(html, /3 Std\./);
  assert.match(html, /Bestätigung offen/);
  assert.match(html, /Bestätigt/);
  assert.match(html, /2 Reststunden wegen Reservemangels abgesagt/);
  assert.ok(html.indexOf('dateTime="2026-10-20"') < html.indexOf('dateTime="2026-10-21"'));
});

test('school details never guess lesson times from the demand when a snapshot is missing or invalid', () => {
  for (const lessonHours of [undefined, null, '[3]', '[3,3,6]', '{"2":[3,4,6]}']) {
    const html = render([{ ...assignment, lessonHours }]);
    assert.match(html, /Beginn bitte mit der Mobilen Reserve abstimmen/);
    assert.doesNotMatch(html, /ab 1\.|1\. Stunde|Beginn bitte mit der Schule abstimmen/);
    assert.match(html, /3 Std\./);
  }
});

test('school contact links retain visible addresses and support calling or composing an email', () => {
  const html = render([assignment], { ...teacher, phone: '+49 (0)89 / 123-456', email: 'reserve+schule@example.invalid' });
  assert.match(html, /href="tel:\+4989123456"/);
  assert.match(html, /\+49 \(0\)89 \/ 123-456/);
  assert.match(html, /href="mailto:reserve%2Bschule@example\.invalid"/);
  assert.match(html, /reserve\+schule@example\.invalid/);
  assert.match(html, /Fachlehrkraft/);
  assert.match(html, /Grundschule/);
});

test('contact fallbacks stay visible and stored URI characters cannot add mail headers or scripts', () => {
  const absent = render([assignment], { ...teacher, phone: undefined, email: undefined });
  assert.match(absent, /Keine Nummer/);
  assert.match(absent, /Keine Mail/);
  const invalid = render([assignment], { ...teacher, phone: 'javascript:alert(1)', email: 'invalid email' });
  assert.doesNotMatch(invalid, /href=/);
  assert.match(invalid, /javascript:alert\(1\)/);
  const injected = render([assignment], { ...teacher, email: 'reserve@example.invalid?bcc=someone@example.invalid' });
  assert.doesNotMatch(injected, /href=/, 'multiple mailbox syntax stays plain text');
  const query = render([assignment], { ...teacher, email: 'reserve@example.invalid?subject=secret' });
  assert.match(query, /href="mailto:reserve@example\.invalid%3Fsubject%3Dsecret"/);
  assert.doesNotMatch(query, /href="[^"]*\?subject=/);
});

test('school assignment dates use the Berlin school day on a different device timezone', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const html = render([{ ...assignment, date: '2026-10-19T22:30:00Z' }]);
    assert.match(html, /dateTime="2026-10-20"/);
    assert.match(html, /Di\., 20\.10\./);
    assert.match(html, /3\., 4\., 6\. Stunde/);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
