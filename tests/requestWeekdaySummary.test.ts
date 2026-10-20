import test from 'node:test';
import assert from 'node:assert/strict';
import { getRequestWeekdaySummary } from '../src/lib/requestWeekdaySummary';
import type { AssignmentData } from '../src/types/models';

const today = new Date('2026-10-19T10:00:00Z');
const dailyRequest = { date: '2026-10-20T00:00:00.000Z', hours: 5 };
const weeklyRequest = { date: '2026-10-19', endDate: '2026-10-30', hours: 5 };
const summary = (request: Parameters<typeof getRequestWeekdaySummary>[0], now = today) => getRequestWeekdaySummary(request, now);
const required = (request: Parameters<typeof getRequestWeekdaySummary>[0]) => summary(request)?.days.map(day => day.requiredHours);
const assignment = (date: string, hours: number, status = 'PENDING', cancelledHours = 0): AssignmentData => ({
  id: `assignment-${date}-${status}`, requestId: 'request', teacherId: 'teacher', date, hours, status, cancelledHours,
});
const refusal = (date: string, revertedAt?: string) => ({ date, reason: null, decidedAt: '2026-10-19T08:00:00Z', revertedAt });

test('single-day requests show hours only on their actual weekday in an explicit week', () => {
  assert.deepEqual(required(dailyRequest), [0, 5, 0, 0, 0]);
  assert.equal(summary(dailyRequest)?.weekStart, '2026-10-19');
  assert.equal(summary(dailyRequest)?.weekEnd, '2026-10-23');
});

test('an open request counts saved lessons per date within its current planning horizon', () => {
  assert.deepEqual(required({
    ...dailyRequest,
    isOpenEnded: true,
    schedule: JSON.stringify({ '2': [1, 2, 4, 5, 6], '3': [2, 3, 4] }),
  }), [0, 5, 3, 0, 0]);
  const later = summary({ ...weeklyRequest, endDate: undefined, isOpenEnded: true }, new Date('2026-10-21T10:00:00Z'));
  assert.deepEqual(later?.days.map(day => day.requiredHours), [0, 0, 5, 5, 5]);
});

test('short ranges exclude weekdays outside their dates and never combine adjacent weeks', () => {
  assert.deepEqual(required({
    ...dailyRequest,
    endDate: '2026-10-21T00:00:00.000Z',
    schedule: JSON.stringify({ '1': [1, 2], '2': [1, 2, 3], '3': [4], '5': [1, 2] }),
  }), [0, 3, 1, 0, 0]);
  assert.deepEqual(required({ ...dailyRequest, date: '2026-10-23', endDate: '2026-10-26' }), [0, 0, 0, 0, 5]);
});

test('partial assignments reduce only the open hours on the assigned date', () => {
  const result = summary({ ...weeklyRequest, assignments: [assignment('2026-10-19', 3)] });
  assert.deepEqual(result?.days.map(day => [day.openHours, day.requiredHours]), [[2, 5], [5, 5], [5, 5], [5, 5], [5, 5]]);
});

test('day refusals and cancelled remaining hours stay distinct from covered hours', () => {
  const result = summary({
    ...weeklyRequest,
    assignments: [assignment('2026-10-19', 3, 'ACCEPTED', 2)],
    unfilledDays: JSON.stringify([refusal('2026-10-20'), refusal('2026-10-21', '2026-10-19T09:00:00Z')]),
  });
  assert.deepEqual(result?.days.slice(0, 3).map(day => [day.openHours, day.requiredHours, day.declinedHours]), [[0, 5, 2], [0, 5, 5], [5, 5, 0]]);
});

test('cancelled assignments reopen the hours and their previously cancelled remainder', () => {
  const result = summary({ ...weeklyRequest, assignments: [assignment('2026-10-19', 3, 'REJECTED', 2), assignment('2026-10-20', 5, 'CANCELLED')] });
  assert.deepEqual(result?.days.slice(0, 2).map(day => [day.openHours, day.declinedHours]), [[5, 0], [5, 0]]);
});

test('a completed first week advances to the next open week without carrying over its assignments', () => {
  const assignments = ['19', '20', '21', '22', '23'].map(day => assignment(`2026-10-${day}`, 5));
  const result = summary({ ...weeklyRequest, assignments });
  assert.equal(result?.weekStart, '2026-10-26');
  assert.deepEqual(result?.days.map(day => [day.openHours, day.requiredHours]), [[5, 5], [5, 5], [5, 5], [5, 5], [5, 5]]);
});

test('the next upcoming open week is preferred to stale uncovered dates', () => {
  const result = summary(weeklyRequest, new Date('2026-10-26T10:00:00Z'));
  assert.equal(result?.weekStart, '2026-10-26');
});

test('invalid schedules and date ranges remain unavailable instead of looking like known requirements', () => {
  for (const schedule of ['broken', '{"2":3}', '{"2":[1,1]}', '{}']) {
    assert.equal(summary({ ...dailyRequest, schedule }), null);
  }
  assert.equal(summary({ ...dailyRequest, date: '2026-02-31' }), null);
  assert.equal(summary({ ...dailyRequest, endDate: '2026-10-19' }), null);
});
