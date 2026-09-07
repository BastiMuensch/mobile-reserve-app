import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateKeyStrict,
  isValidDateKey,
  toLocalDateInputValue,
  toCanonicalUtcDate,
  inclusiveCalendarDaysBetween,
} from '../src/lib/dateKey';

test('parseDateKeyStrict accepts valid dates', () => {
  const d1 = parseDateKeyStrict('2026-05-12');
  assert.equal(d1.toISOString(), '2026-05-12T00:00:00.000Z');

  // Leap year
  const leap = parseDateKeyStrict('2024-02-29');
  assert.equal(leap.toISOString(), '2024-02-29T00:00:00.000Z');
});

test('parseDateKeyStrict rejects impossible calendar dates', () => {
  assert.throws(() => parseDateKeyStrict('2026-02-31'), /existiert nicht im Kalender/);
  assert.throws(() => parseDateKeyStrict('2026-04-31'), /existiert nicht im Kalender/);
  assert.throws(() => parseDateKeyStrict('2025-02-29'), /existiert nicht im Kalender/); // non leap
  assert.throws(() => parseDateKeyStrict('2026-00-10'), /Ungültiger Monat/);
  assert.throws(() => parseDateKeyStrict('2026-13-10'), /Ungültiger Monat/);
  assert.throws(() => parseDateKeyStrict('2026/05/12'), /Ungültiges Datumsformat/);
  assert.throws(() => parseDateKeyStrict('invalid'), /Ungültiges Datumsformat/);
});

test('isValidDateKey returns boolean correctly', () => {
  assert.equal(isValidDateKey('2026-05-12'), true);
  assert.equal(isValidDateKey('2024-02-29'), true);
  assert.equal(isValidDateKey('2026-02-31'), false);
  assert.equal(isValidDateKey('not-a-date'), false);
  assert.equal(isValidDateKey(null), false);
  assert.equal(isValidDateKey(undefined), false);
});

test('toLocalDateInputValue returns German local date around midnight', () => {
  // 2026-05-11 22:30:00 UTC is 2026-05-12 00:30:00 CEST (Europe/Berlin)
  const justAfterMidnightBerlin = new Date('2026-05-11T22:30:00.000Z');
  const result = toLocalDateInputValue(justAfterMidnightBerlin);
  assert.equal(result, '2026-05-12');
});

test('toCanonicalUtcDate returns canonical midnight UTC date', () => {
  const d = toCanonicalUtcDate('2026-05-12');
  assert.equal(d.toISOString(), '2026-05-12T00:00:00.000Z');

  // Also when given Date object that might be in a different timezone
  const dObj = new Date('2026-05-11T23:00:00.000Z'); // 01:00 CEST on May 12
  const canonical = toCanonicalUtcDate(dObj);
  assert.equal(canonical.toISOString(), '2026-05-12T00:00:00.000Z');
});

test('inclusiveCalendarDaysBetween calculates correctly', () => {
  assert.equal(inclusiveCalendarDaysBetween('2026-05-01', '2026-05-01'), 1);
  assert.equal(inclusiveCalendarDaysBetween('2026-05-01', '2026-05-05'), 5);
  assert.equal(inclusiveCalendarDaysBetween('2026-02-28', '2026-03-01'), 2);
  assert.throws(() => inclusiveCalendarDaysBetween('2026-05-05', '2026-05-01'), /liegt vor Startdatum/);
});
