import test from 'node:test';
import assert from 'node:assert/strict';
import {
  batchPlanningSchema, getBatchPlanningWindow, areBatchEntriesInWindow,
  requireBatchOvertimeConsent, BatchOvertimeConfirmationRequired,
} from '../src/lib/batchPlanning';

const now = new Date('2026-09-07T12:00:00Z');

test('batch planning includes today and cutoff, excludes history and dates outside selected year', () => {
  const window = getBatchPlanningWindow({ schoolYear: '2026/2027', until: '2026-09-18' }, now);
  assert.deepEqual(window, { schoolYear: '2026/2027', from: '2026-09-07', until: '2026-09-18' });
  assert.equal(areBatchEntriesInWindow([{ date: window.from }, { date: window.until }], window), true);
  for (const date of ['2026-09-06', '2026-09-19', '2027-09-01', '2026-02-31']) {
    assert.equal(areBatchEntriesInWindow([{ date }], window), false, date);
  }
});

test('batch planning starts a future year on September 1 and rejects a finished year', () => {
  assert.equal(getBatchPlanningWindow({ schoolYear: '2027/2028', until: '2027-09-10' }, now).from, '2027-09-01');
  assert.throws(() => getBatchPlanningWindow({ schoolYear: '2025/2026', until: '2026-08-31' }, now), /abgeschlossen/);
  assert.throws(() => getBatchPlanningWindow({ schoolYear: '2026/2027', until: '2026-09-06' }, now), /Vergangenheit/);
  assert.throws(() => getBatchPlanningWindow({ schoolYear: '2026/2027', until: '2027-09-01' }, now), /Schuljahres/);
});

test('batch calendar day respects Berlin at midnight regardless of server timezone', () => {
  const window = getBatchPlanningWindow({ schoolYear: '2026/2027', until: '2026-09-08' }, new Date('2026-09-07T22:05:00Z'));
  assert.equal(window.from, '2026-09-08');
  assert.equal(areBatchEntriesInWindow([{ date: '2026-09-07' }], window), false);
});

test('batch planning schema requires an adjacent school year and a real calendar date', () => {
  for (const input of [
    { until: '2026-09-10' },
    { schoolYear: '2026/2028', until: '2026-09-10' },
    { schoolYear: '2026/2027', until: '2027-02-29' },
  ]) assert.equal(batchPlanningSchema.safeParse(input).success, false);
});

test('overtime requires explicit consent and preserves meaningful warnings', () => {
  assert.doesNotThrow(() => requireBatchOvertimeConsent([], false));
  assert.doesNotThrow(() => requireBatchOvertimeConsent(['Lehrkraft A: 30/28 Stunden'], true));
  assert.throws(() => requireBatchOvertimeConsent(['Lehrkraft A: 30/28 Stunden', 'Lehrkraft A: 30/28 Stunden'], false), error => {
    assert.ok(error instanceof BatchOvertimeConfirmationRequired);
    assert.deepEqual(error.warnings, ['Lehrkraft A: 30/28 Stunden']);
    return true;
  });
});
