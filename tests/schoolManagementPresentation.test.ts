import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchoolManager } from '../src/components/schulamt/SchoolManager';
import { ConfirmProvider } from '../src/components/ui/confirm-dialog';
import { ToastProvider } from '../src/components/ui/toast';
import { school } from './fixtures/uiRegressionData';
import type { SchoolData } from '../src/types/models';

function render(schools: SchoolData[]) {
  const fail = () => { throw new Error('Rendering must not change accounts or schools'); };
  return renderToStaticMarkup(createElement(ToastProvider, null,
    createElement(ConfirmProvider, null, createElement(SchoolManager, {
      sortedSchools: schools, newSchool: { name: '', address: '', type: 'GRUNDSCHULE', email: '', password: '' },
      isAddingSchool: false, editingPasswordId: null, newEmail: '', newPassword: '',
      handleAddSchool: fail, setNewSchool: fail, setEditingPasswordId: fail, setNewEmail: fail,
      setNewPassword: fail, handleUpdateCredentials: fail, onChanged: fail,
    })),
  ));
}

test('school overview exposes editing, single/all account letters, deletion and school-type controls', () => {
  const html = render([{ ...school, type: 'GS_MS', user: { id: 'login', role: 'SCHOOL', email: 'schule@example.invalid' } }]);
  for (const label of ['Schulart ändern', 'Zugangsdaten ändern', 'Accountbrief erstellen', 'Schule löschen',
    'Accountbriefe für alle Schulen (1)', 'Nach Schulart filtern', 'Sortierung', 'Grund- und Mittelschule']) {
    assert.ok(html.includes(label), `Missing visible action or label: ${label}`);
  }
});

test('empty school directory has no per-school destructive or credential action', () => {
  const html = render([]);
  assert.match(html, /Noch keine Schulen angelegt/);
  assert.ok(html.includes('Accountbriefe für alle Schulen (0)'));
  assert.doesNotMatch(html, />Schulart ändern<|>Accountbrief erstellen<|>Schule löschen</);
});

test('bulk account letters count only schools with a school login and explain exclusions', () => {
  const html = render([
    { ...school, id: 'with-login', user: { id: 'login', role: 'SCHOOL', email: 'schule@example.invalid' } },
    { ...school, id: 'without-login', user: undefined },
  ]);
  assert.ok(html.includes('Accountbriefe für alle Schulen (1)'));
  assert.ok(html.includes('Schulen ohne Schulzugang sind nicht im Sammelbrief enthalten.'));
});
