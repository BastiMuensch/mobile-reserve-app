import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStartHourForDay, requestStartLabelForDay } from '../src/lib/requestTiming';

const weeklyRequest = { startHour: 1, schedule: JSON.stringify({ 1: [5, 3, 4], 2: [5, 6], 3: [2, 4], 4: [] }) };

test('weekly requests use each assignment weekday rather than the startHour placeholder', () => {
  assert.equal(requestStartHourForDay(weeklyRequest, '2026-10-12'), 3);
  assert.equal(requestStartHourForDay(weeklyRequest, '2026-10-13'), 5);
  assert.equal(requestStartHourForDay(weeklyRequest, '2026-10-14'), 2);
  assert.equal(requestStartHourForDay(weeklyRequest, '2026-10-19'), 3);
  assert.equal(requestStartLabelForDay(weeklyRequest, '2026-10-12'), 'ab 3. Std.');
});

test('single-day and historic requests without a schedule retain their stated start', () => {
  assert.equal(requestStartHourForDay({ startHour: 3 }, '2026-10-12'), 3);
  assert.equal(requestStartHourForDay({ startHour: 5, schedule: null }, '2026-10-12'), 5);
  assert.equal(requestStartLabelForDay({ startHour: 3 }, '2026-10-12'), 'ab 3. Std.');
});

test('missing or unusable daily schedules do not claim a first-period start', () => {
  for (const date of ['2026-10-15', '2026-10-16', '2026-10-17', 'not-a-date']) {
    assert.equal(requestStartHourForDay(weeklyRequest, date), null);
  }
  for (const schedule of ['{invalid', 'null', '[]', '{"1":"3"}', '{"1":[0,3]}', '{"1":[11]}']) {
    assert.equal(requestStartHourForDay({ startHour: 1, schedule }, '2026-10-12'), null);
  }
  assert.equal(requestStartHourForDay(undefined, '2026-10-12'), null);
  assert.equal(requestStartHourForDay({ startHour: 0 }, '2026-10-12'), null);
  assert.equal(requestStartLabelForDay(weeklyRequest, '2026-10-15'), 'Beginn bitte mit der Schule abstimmen');
});

test('the school weekday uses Berlin time regardless of browser or server timezone', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      assert.equal(requestStartHourForDay(weeklyRequest, '2026-10-12'), 3, zone);
      assert.equal(requestStartHourForDay(weeklyRequest, new Date('2026-10-11T22:30:00Z')), 3, zone);
      assert.equal(requestStartHourForDay(weeklyRequest, new Date('2026-10-25T23:30:00Z')), 3, zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
