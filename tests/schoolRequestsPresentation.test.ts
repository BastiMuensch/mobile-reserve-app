import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchoolRequestsList } from '../src/components/school/SchoolRequestsList';
import { openRequest } from './fixtures/uiRegressionData';

function render(request = openRequest, loading = false) {
  return renderToStaticMarkup(createElement(SchoolRequestsList, {
    requests: [request], loading,
    handleCancel: () => { throw new Error('Rendering must not cancel a request'); },
    handleEndRequest: () => { throw new Error('Rendering must not end a request'); },
  }));
}

test('cards and tables preserve weekly hours, notes and both allowed actions', () => {
  const html = render();
  assert.equal((html.match(/22 Std\.\/Woche/g) || []).length, 2);
  assert.equal((html.match(/Hinweise ansehen/g) || []).length, 2);
  assert.equal((html.match(/aria-label="Anfrage stornieren"/g) || []).length, 2);
  assert.equal((html.match(/Rückkehr melden/g) || []).length, 2);
  assert.match(html, /@container\/requests/);
  assert.match(html, /table-fixed/);
});

test('filled requests cannot be cancelled but ongoing requests can be ended', () => {
  const html = render({ ...openRequest, status: 'FILLED' });
  assert.doesNotMatch(html, /Anfrage stornieren/);
  assert.equal((html.match(/Rückkehr melden/g) || []).length, 2);
});

test('closed unfilled requests show reason access but no action', () => {
  const html = render({ ...openRequest, status: 'UNFILLED', isOpenEnded: false });
  assert.match(html, /Ohne Begründung/);
  assert.doesNotMatch(html, /Anfrage stornieren|Rückkehr melden/);
});

test('past requests stay in the collapsed archive; loading does not render actions', () => {
  const html = render({ ...openRequest, date: '2000-01-03', isOpenEnded: false });
  assert.match(html, /Archiv \(1 vergangene Anfrage\)/);
  assert.doesNotMatch(html, /Anfrage stornieren|Rückkehr melden/);
  const loading = render(openRequest, true);
  assert.match(loading, /Lade Anfragen/);
  assert.doesNotMatch(loading, /Anfrage stornieren|Rückkehr melden/);
});
