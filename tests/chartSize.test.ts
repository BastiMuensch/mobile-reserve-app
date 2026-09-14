import assert from 'node:assert/strict';
import test from 'node:test';
import { getChartSize } from '@/components/schulamt/chartSize';

test('does not mount a chart for Recharts’ initial SSR dimensions', () => {
  assert.equal(getChartSize(-1, -1), null);
});

test('only returns rounded positive, finite chart dimensions', () => {
  assert.deepEqual(getChartSize(319.6, 299.5), { width: 320, height: 300 });

  for (const [width, height] of [
    [0, 300],
    [-1, 300],
    [0.4, 300],
    [300, 0.4],
    [Number.NaN, 300],
    [300, Number.NaN],
    [Number.POSITIVE_INFINITY, 300],
    [300, Number.NEGATIVE_INFINITY],
  ]) {
    assert.equal(getChartSize(width, height), null);
  }
});
