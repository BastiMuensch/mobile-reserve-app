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
  assert.match(render(true), /Dringlichkeitshinweis fürs Schulamt hinzufügen/);
  assert.doesNotMatch(render(true), /id="urgencyNote"/, 'the school still chooses whether to add a note');
});
