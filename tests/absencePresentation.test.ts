import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeachersList } from '../src/components/schulamt/TeachersList';
import { teacher } from './fixtures/uiRegressionData';

test('office list exposes dated absence details as escaped text, including future planning', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(TeachersList, {
    filteredTeachers: [{ ...teacher, absences: [
      { id: 'future', date: '2099-09-20T00:00:00Z', type: 'UNAVAILABLE', reason: '<script>planning</script>\nSecond line' },
      { id: 'cleared', date: '2099-09-19T00:00:00Z', type: 'UNAVAILABLE', reason: null },
    ] }], searchTeacherQuery: '', setSearchTeacherQuery: noop, toggleAbsence: noop,
    openEdit: noop, setFocusedLocation: noop, openArchive: noop, openMonthlyExport: noop,
    openLeavePeriods: noop, openDelete: noop,
  }));
  assert.match(html, /Ausfallmeldungen \(2\)/);
  assert.match(html, /20\.9\.2099/);
  assert.match(html, /&lt;script&gt;planning&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Keine Begründung mehr gespeichert/);
});
