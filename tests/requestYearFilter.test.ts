import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestYearOverlapFilter } from '../src/lib/requestYearFilter';

test('school-year request filter requires both a start before year-end and an end after year-start', () => {
  const start = new Date('2026-09-01T00:00:00.000Z');
  const end = new Date('2027-08-31T23:59:59.999Z');

  assert.deepEqual(buildRequestYearOverlapFilter(start, end), {
    AND: [
      { date: { lte: end } },
      {
        OR: [
          { endDate: { gte: start } },
          { isOpenEnded: true, endDate: null },
          { isOpenEnded: false, endDate: null, date: { gte: start } },
        ],
      },
    ],
  });
});

test('open-ended requests still carry into later years without losing the upper start bound', () => {
  const start = new Date('2027-09-01T00:00:00.000Z');
  const end = new Date('2028-08-31T23:59:59.999Z');
  const filter = buildRequestYearOverlapFilter(start, end);
  const clauses = filter.AND as Array<Record<string, unknown>>;

  assert.deepEqual(clauses[0], { date: { lte: end } });
  assert.deepEqual(clauses[1], {
    OR: [
      { endDate: { gte: start } },
      { isOpenEnded: true, endDate: null },
      { isOpenEnded: false, endDate: null, date: { gte: start } },
    ],
  });
});
