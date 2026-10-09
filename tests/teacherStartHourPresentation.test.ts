import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeacherNextAssignment } from '../src/components/teacher/TeacherNextAssignment';
import { ToastProvider } from '../src/components/ui/toast';
import { openRequest } from './fixtures/uiRegressionData';
import type { AssignmentData } from '../src/types/models';

function render(date: string, schedule: string | null = JSON.stringify({ 1: [3, 4], 2: [5, 6] }), startHour = 1) {
  const assignment: AssignmentData = {
    id: 'assignment', teacherId: 'teacher', requestId: openRequest.id, date, hours: 2, status: 'ACCEPTED',
    request: { ...openRequest, startHour, schedule: schedule ?? undefined, comments: undefined },
  };
  return renderToStaticMarkup(createElement(ToastProvider, null,
    createElement(TeacherNextAssignment, { nextAssignment: assignment, assignments: [assignment] })));
}

test('reserve next-assignment card shows the start for its actual weekday', () => {
  const monday = render('2026-10-12');
  const tuesday = render('2026-10-13');
  assert.match(monday, /Einsatzbeginn/);
  assert.match(monday, /ab 3\. Std\./);
  assert.match(tuesday, /ab 5\. Std\./);
  assert.doesNotMatch(monday + tuesday, /ab 1\. Std\./);
});

test('reserve start display preserves single-day starts and flags unscheduled manual days', () => {
  assert.match(render('2026-10-12', null, 3), /ab 3\. Std\./);
  assert.match(render('2026-10-14'), /Beginn bitte mit der Schule abstimmen/);
});

test('the displayed assignment date and lesson start refer to the same German school day', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const html = render('2026-10-12T00:00:00Z');
    assert.match(html, /12\.10\.2026/);
    assert.match(html, /ab 3\. Std\./);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
