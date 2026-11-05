import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeachersList } from '../src/components/schulamt/TeachersList';
import { teacher } from './fixtures/uiRegressionData';
import type { TeacherData } from '../src/types/models';

function renderTeachers(teachers: TeacherData[]) {
  const noop = () => {};
  return renderToStaticMarkup(createElement(TeachersList, {
    filteredTeachers: teachers, searchTeacherQuery: '', setSearchTeacherQuery: noop, toggleAbsence: noop,
    openEdit: noop, setFocusedLocation: noop, openArchive: noop, openMonthlyExport: noop,
    openLeavePeriods: noop, openDelete: noop,
  }));
}

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

test('today absence filter counts both office-marked and self-reported unavailability', () => {
  const html = renderTeachers([
    { ...teacher, id: 'manual', status: 'UNAVAILABLE', isAbsentToday: false },
    { ...teacher, id: 'reported', status: 'ACTIVE', isAbsentToday: true },
    { ...teacher, id: 'available', status: 'ACTIVE', isAbsentToday: false },
  ]);
  const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match => match[1].replace(/<[^>]*>/g, ''));
  assert.ok(buttons.includes('Ausfall heute (2)'), buttons.join('\n'));
});

test('weekly capacity uses approved actuals, including zero, and keeps unreported planned hours', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') });
  const assignment = { requestId: 'request', teacherId: teacher.id, date: '2026-11-05', hours: 6, status: 'ACCEPTED' };
  const html = renderTeachers([{ ...teacher, maxWeeklyHours: 6, assignments: [
    { ...assignment, id: 'approved', actualHours: 2 },
    { ...assignment, id: 'unreported', hours: 3, actualHours: null },
    { ...assignment, id: 'zero', actualHours: 0 },
    { ...assignment, id: 'cancelled', status: 'CANCELLED' },
    { ...assignment, id: 'rejected', status: 'REJECTED' },
    { ...assignment, id: 'last-week', date: '2026-10-30' },
  ] }]);
  assert.match(html, /5 \/ 6 Std\. diese Woche/);
  const overtime = renderTeachers([{ ...teacher, maxWeeklyHours: 6, assignments: [{ ...assignment, id: 'extra', hours: 2, actualHours: 8 }] }]);
  assert.match(overtime, /8 \/ 6 Std\. diese Woche/);
});
