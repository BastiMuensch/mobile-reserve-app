import test from 'node:test';
import assert from 'node:assert/strict';
import { requestLessonSummary } from '../src/lib/requestLessonSummary';

test('weekly request details preserve different daily starts and gaps', () => {
  assert.equal(requestLessonSummary({
    startHour: 1, schedule: JSON.stringify({ '1': [5, 3, 4], '3': [2, 4] }),
  }), 'Mo: 3., 4., 5. Std. · Mi: 2., 4. Std.');
});

test('daily request details retain the stated first lesson', () => {
  assert.equal(requestLessonSummary({ startHour: 3 }), 'ab 3. Std.');
});

test('unusable weekly plans never claim their placeholder as a start', () => {
  assert.equal(requestLessonSummary({ startHour: 1, schedule: '{"1":42}' }), 'Unterricht laut Wochenstundenplan');
});
