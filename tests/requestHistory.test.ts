import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionRequestHistory, type UnfilledHistoryEntry } from '../src/lib/requestHistory';
import { openRequest, teacher } from './fixtures/uiRegressionData';
import type { RequestData } from '../src/types/models';

const now = new Date('2026-10-15T10:00:00Z');

function assigned(id: string, date: string, extra: Partial<RequestData> = {}): RequestData {
  return {
    ...openRequest, id, date, schedule: undefined, isOpenEnded: false, status: 'FILLED',
    assignments: [{ id: `${id}-assignment`, requestId: id, teacherId: teacher.id, teacher, date, hours: 6, status: 'ACCEPTED' }],
    ...extra,
  };
}

test('history includes exactly seven Berlin calendar days plus future assignments', () => {
  const rows = [assigned('older', '2026-10-08'), assigned('boundary', '2026-10-09'), assigned('today', '2026-10-15'), assigned('future', '2026-11-03')];
  const result = partitionRequestHistory(rows, [], now);
  assert.equal(result.cutoff, '2026-10-09');
  assert.deepEqual(result.recent.assigned.map(row => row.id), ['boundary', 'today', 'future']);
  assert.deepEqual(result.archive.assigned.map(row => row.id), ['older']);
});

test('long-running requests stay visible and their full assignment history stays intact', () => {
  const ongoing = assigned('ongoing', '2026-09-01', { isOpenEnded: true });
  const extended = assigned('extended', '2026-09-01', { endDate: '2026-10-16' });
  const recentAssignment = assigned('recent-assignment', '2026-10-14').assignments[0];
  const multiday = assigned('multiday', '2026-09-01', { endDate: '2026-10-14' });
  multiday.assignments.push(recentAssignment);
  const result = partitionRequestHistory([ongoing, extended, multiday], [], now);
  assert.equal(result.recent.assigned.length, 3);
  assert.equal(result.archive.assigned.length, 0);
  assert.strictEqual(result.recent.assigned[2], multiday);
  assert.equal(result.recent.assigned[2].assignments.length, 2);
});

test('cancelled assignments do not keep a completed request in the recent view', () => {
  const request = assigned('old', '2026-10-01');
  request.assignments.push(
    { ...request.assignments[0], id: 'rejected', date: '2026-10-15', status: 'REJECTED' },
    { ...request.assignments[0], id: 'cancelled', date: '2026-10-15', status: 'CANCELLED' },
  );
  const result = partitionRequestHistory([request], [], now);
  assert.deepEqual(result.recent.assigned, []);
  assert.strictEqual(result.archive.assigned[0], request);
  assert.equal(result.archive.assigned[0].assignments.length, 3);
});

test('refused days of the same request split by service date, preserving reasons and reversals', () => {
  const request = assigned('series', '2026-09-01', { isOpenEnded: true });
  const entries: UnfilledHistoryEntry[] = ['2026-10-08', '2026-10-09', '2026-10-19'].map(date => ({ req: request, date, reason: 'Keine Reserve', decidedAt: '2026-10-01T09:00:00Z' }));
  const before = JSON.stringify(entries);
  const result = partitionRequestHistory([], entries, now);
  assert.deepEqual(result.recent.unfilled.map(entry => entry.date), ['2026-10-09', '2026-10-19']);
  assert.strictEqual(result.archive.unfilled[0], entries[0]);
  assert.strictEqual(result.archive.unfilled[0].req, request);
  assert.equal(JSON.stringify(entries), before);
});

test('legacy refusals respect the full range and an open-ended request', () => {
  const entries: UnfilledHistoryEntry[] = [
    { req: assigned('old', '2026-09-01', { endDate: '2026-10-08' }) },
    { req: assigned('recent', '2026-09-01', { endDate: '2026-10-09' }) },
    { req: assigned('ongoing', '2026-09-01', { isOpenEnded: true }) },
  ];
  const result = partitionRequestHistory([], entries, now);
  assert.deepEqual(result.archive.unfilled.map(entry => entry.req.id), ['old']);
  assert.deepEqual(result.recent.unfilled.map(entry => entry.req.id), ['recent', 'ongoing']);
});

test('cutoff uses Berlin midnight and calendar arithmetic across DST and year boundaries', () => {
  assert.equal(partitionRequestHistory([], [], new Date('2026-10-14T22:05:00Z')).cutoff, '2026-10-09');
  assert.equal(partitionRequestHistory([], [], new Date('2026-10-26T00:05:00Z')).cutoff, '2026-10-20');
  assert.equal(partitionRequestHistory([], [], new Date('2027-01-02T00:05:00Z')).cutoff, '2026-12-27');
});
