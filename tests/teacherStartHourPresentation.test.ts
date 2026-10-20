import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeacherNextAssignment } from '../src/components/teacher/TeacherNextAssignment';
import { ToastProvider } from '../src/components/ui/toast';
import { openRequest } from './fixtures/uiRegressionData';
import type { AssignmentData } from '../src/types/models';

function render(date: string, {
  lessonHours, schedule = JSON.stringify({ 1: [1, 2, 3, 4], 2: [1, 2, 5, 6] }), startHour = 1,
}: { lessonHours?: string | null; schedule?: string | null; startHour?: number } = {}) {
  const assignment: AssignmentData = {
    id: 'assignment', teacherId: 'teacher', requestId: openRequest.id, date, hours: 2, lessonHours, status: 'ACCEPTED',
    request: { ...openRequest, startHour, schedule: schedule ?? undefined, comments: undefined },
  };
  return renderToStaticMarkup(createElement(ToastProvider, null,
    createElement(TeacherNextAssignment, { nextAssignment: assignment, assignments: [assignment] })));
}

test('reserve next-assignment card shows actual partial-assignment starts instead of the earlier demand', () => {
  const monday = render('2026-10-12', { lessonHours: '[3,4]' });
  const tuesday = render('2026-10-13', { lessonHours: '[5,6]' });
  assert.match(monday, /Einsatzbeginn/);
  assert.match(monday, /ab 3\. Std\./);
  assert.match(tuesday, /ab 5\. Std\./);
  assert.doesNotMatch(monday + tuesday, /ab 1\. Std\./);
});

test('reserve start display preserves saved lessons after request timing changes', () => {
  assert.match(render('2026-10-12', { lessonHours: '[3,4]', schedule: null, startHour: 1 }), /ab 3\. Std\./);
  assert.match(render('2026-10-12', { lessonHours: '[3,4]', schedule: '{"1":[5,6]}' }), /ab 3\. Std\./);
});

test('legacy and invalid lesson snapshots ask for coordination instead of guessing from the request', () => {
  for (const lessonHours of [undefined, null, '[3]', '[3,3]']) {
    const html = render('2026-10-12', { lessonHours, schedule: null, startHour: 3 });
    assert.match(html, /Beginn bitte mit der Schule abstimmen/);
    assert.doesNotMatch(html, /ab 3\. Std\./);
  }
});

test('the displayed assignment date and lesson start refer to the same German school day', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const html = render('2026-10-12T00:00:00Z', { lessonHours: '[3,4]' });
    assert.match(html, /12\.10\.2026/);
    assert.match(html, /ab 3\. Std\./);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
