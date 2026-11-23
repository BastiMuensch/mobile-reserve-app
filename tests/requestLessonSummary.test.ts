import test from 'node:test';
import assert from 'node:assert/strict';
import { requestLessonSummary } from '../src/lib/requestLessonSummary';

test('weekly request details preserve different daily starts and gaps', () => {
  assert.equal(requestLessonSummary({
    startHour: 1, isOpenEnded: true, schedule: JSON.stringify({ '1': [5, 3, 4], '3': [2, 4] }),
  }), 'Mo: 3., 4., 5. Std. · Mi: 2., 4. Std.');
});

test('daily request details retain the stated first lesson', () => {
  assert.equal(requestLessonSummary({ startHour: 3 }), 'ab 3. Std.');
});

test('daily lesson selections show the exact slots', () => {
  const request = { date: '2026-11-24', startHour: 2, schedule: '{"2":[5,2]}' };
  assert.equal(requestLessonSummary(request), '2., 5. Std.');
  assert.equal(requestLessonSummary({ ...request, endDate: request.date }), '2., 5. Std.');
});

test('unusable weekly plans never claim their placeholder as a start', () => {
  assert.equal(requestLessonSummary({ startHour: 1, endDate: '2026-11-27', schedule: '{"1":42}' }), 'Unterricht laut Wochenstundenplan');
});
