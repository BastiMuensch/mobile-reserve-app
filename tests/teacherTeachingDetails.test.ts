import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssignmentDayBlocks, TeacherNextAssignment } from '../src/components/teacher/TeacherNextAssignment';
import { ToastProvider } from '../src/components/ui/toast';
import { openRequest } from './fixtures/uiRegressionData';
import type { AssignmentData, RequestData } from '../src/types/models';

function assignment(id: string, request: Partial<RequestData>): AssignmentData {
  return {
    id, teacherId: 'teacher', requestId: id, date: '2026-11-09', hours: 2, lessonHours: '[1,2]', status: 'ACCEPTED',
    request: { ...openRequest, ...request, id, comments: undefined },
  };
}

test('specialist next assignment names the requested field, year and subject', () => {
  const item = assignment('specialist', {
    schoolType: 'GRUNDSCHULE', requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: 'M/T', gradeLevel: 8, requiredSubject: 'Technik',
  });
  const html = renderToStaticMarkup(createElement(ToastProvider, null,
    createElement(TeacherNextAssignment, { nextAssignment: item, assignments: [item] })));
  assert.equal((html.match(/Fachlehrkraft M\/T/g) ?? []).length, 2, 'Summary and block use the actual deployment requirement');
  assert.match(html, /Jahrgangsstufe<\/dt><dd[^>]*>8<\/dd>/);
  assert.match(html, /Fach<\/dt><dd[^>]*>Technik<\/dd>/);
});

test('each same-day block keeps its own requested deployment information', () => {
  const items = [
    assignment('gs', { schoolType: 'GS_MS', requestedSchoolType: 'GRUNDSCHULE', gradeLevel: 3, requiredSubject: 'Deutsch' }),
    assignment('ms', { schoolType: 'GS_MS', requestedSchoolType: 'MITTELSCHULE', gradeLevel: 7, requiredSubject: 'Englisch' }),
    assignment('specialist', { schoolType: 'GS_MS', requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: 'E/G', gradeLevel: 8, requiredSubject: 'Ernährung und Soziales' }),
  ];
  const html = renderToStaticMarkup(createElement(AssignmentDayBlocks, { assignments: items }));
  const blocks = [...html.matchAll(/<dl[^>]*>(.*?)<\/dl>/g)].map(match => match[1]);
  assert.equal(blocks.length, 3);
  for (const [index, expected] of [['Grundschule', '3', 'Deutsch'], ['Mittelschule', '7', 'Englisch'], ['Fachlehrkraft E/G', '8', 'Ernährung und Soziales']].entries()) {
    for (const text of expected) assert.ok(blocks[index].includes(`>${text}</dd>`), `${text} belongs to block ${index + 1}`);
  }
});

test('historical requests retain a readable school type without inventing missing requirements', () => {
  const html = renderToStaticMarkup(createElement(AssignmentDayBlocks, {
    assignments: [assignment('legacy', { schoolType: 'GS_MS', requestedSchoolType: null, requestedSpecialistField: null, gradeLevel: null, requiredSubject: null, qualifications: 'GS, MS' })],
  }));
  assert.match(html, /Grund- und Mittelschule/);
  assert.doesNotMatch(html, /Jahrgangsstufe|<dt[^>]*>Fach<\/dt>|Fachlehrkraft/);
});

test('a specialist request without a field is labelled as any field', () => {
  const html = renderToStaticMarkup(createElement(AssignmentDayBlocks, {
    assignments: [assignment('any-field', { requestedSchoolType: 'FACHLEHRKRAFT', requestedSpecialistField: null })],
  }));
  assert.match(html, /Fachlehrkraft \(beliebige Fachrichtung\)/);
});
