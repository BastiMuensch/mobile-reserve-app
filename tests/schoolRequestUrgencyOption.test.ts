import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchoolRequestForm } from '../src/components/school/SchoolRequestForm';
import { ToastProvider } from '../src/components/ui/toast';

function render(requestUrgencyNoteEnabled?: boolean) {
  return renderToStaticMarkup(createElement(ToastProvider, null,
    createElement(SchoolRequestForm, {
      user: { id: 'school-user', role: 'SCHOOL', email: 'school@example.invalid', schoolId: 'school', teacherId: null },
      fetchRequests: () => {},
      requestUrgencyNoteEnabled,
    }),
  ));
}

test('schools see no urgency option until their office explicitly activates it', () => {
  assert.doesNotMatch(render(), /Dringlichkeitshinweis|urgency-note/);
  assert.doesNotMatch(render(false), /Dringlichkeitshinweis|urgency-note/);
  assert.match(render(true), /Nachricht ans Schulamt hinzufügen/);
  assert.doesNotMatch(render(true), /id="urgencyNote"/, 'the school still chooses whether to add a note');
});

test('new demands require an explicit teaching type and expose separate grade and subject fields', () => {
  const html = render();
  const teachingTypeInputs = html.match(/<input[^>]+name="requestedSchoolType"[^>]*>/g) ?? [];
  assert.equal(teachingTypeInputs.length, 2);
  assert.ok(teachingTypeInputs.every(input => /required=""/.test(input)));
  assert.ok(teachingTypeInputs.some(input => /value="GRUNDSCHULE"/.test(input)));
  assert.ok(teachingTypeInputs.some(input => /value="MITTELSCHULE"/.test(input)));
  assert.match(html, /<select[^>]+id="gradeLevel"/);
  assert.match(html, /<input[^>]+id="requiredSubject"[^>]+maxLength="80"/);
});
