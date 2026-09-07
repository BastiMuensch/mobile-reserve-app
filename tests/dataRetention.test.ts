import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRequestCompletionDate, buildCompletedRequestFilter } from '../src/lib/dataRetention';

describe('GDPR Data Retention - getRequestCompletionDate', () => {
  it('identifies open-ended request without endedAt as still running (null)', () => {
    const req = {
      date: new Date('2024-01-01T00:00:00.000Z'),
      isOpenEnded: true,
      endedAt: null,
      endDate: null,
    };
    assert.equal(getRequestCompletionDate(req), null);
  });

  it('identifies early ended request completion date as endedAt', () => {
    const req = {
      date: new Date('2024-01-01T00:00:00.000Z'),
      isOpenEnded: true,
      endedAt: new Date('2024-03-15T00:00:00.000Z'),
      endDate: null,
    };
    const compDate = getRequestCompletionDate(req);
    assert.ok(compDate);
    assert.equal(compDate.toISOString(), '2024-03-15T00:00:00.000Z');
  });

  it('identifies multi-day fixed request completion date as endDate', () => {
    const req = {
      date: new Date('2024-01-01T00:00:00.000Z'),
      isOpenEnded: false,
      endedAt: null,
      endDate: new Date('2024-01-19T00:00:00.000Z'),
    };
    const compDate = getRequestCompletionDate(req);
    assert.ok(compDate);
    assert.equal(compDate.toISOString(), '2024-01-19T00:00:00.000Z');
  });

  it('identifies single-day request completion date as date', () => {
    const req = {
      date: new Date('2024-01-01T00:00:00.000Z'),
      isOpenEnded: false,
      endedAt: null,
      endDate: null,
    };
    const compDate = getRequestCompletionDate(req);
    assert.ok(compDate);
    assert.equal(compDate.toISOString(), '2024-01-01T00:00:00.000Z');
  });
});

describe('GDPR Data Retention - buildCompletedRequestFilter', () => {
  it('builds query filter matching completion criteria correctly', () => {
    const cutoff = new Date('2025-01-01T00:00:00.000Z');
    const filter = buildCompletedRequestFilter(cutoff);

    assert.ok(filter.OR);
    assert.equal(filter.OR.length, 3);

    // 1. open ended with endedAt < cutoff
    assert.deepEqual(filter.OR[0], {
      isOpenEnded: true,
      endedAt: { not: null, lt: cutoff },
    });

    // 2. fixed period with endDate < cutoff
    assert.deepEqual(filter.OR[1], {
      isOpenEnded: false,
      endDate: { not: null, lt: cutoff },
    });

    // 3. single day with date < cutoff
    assert.deepEqual(filter.OR[2], {
      isOpenEnded: false,
      endDate: null,
      date: { lt: cutoff },
    });
  });
});
