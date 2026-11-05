import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManualCoordinates } from '../src/lib/manualCoordinates';

test('empty or incomplete coordinates never become an accidental zero position', () => {
  for (const [latitude, longitude] of [['', ''], [' ', '\t'], ['', '11.5'], ['48.1', ''], ['0', ' ']]) {
    assert.equal(parseManualCoordinates(latitude, longitude), null);
  }
});

test('explicit zero coordinates and decimal commas remain valid', () => {
  assert.deepEqual(parseManualCoordinates('0', '0'), { lat: 0, lng: 0 });
  assert.deepEqual(parseManualCoordinates(' 0,0 ', '11,5678'), { lat: 0, lng: 11.5678 });
  assert.deepEqual(parseManualCoordinates('48,1234', '0'), { lat: 48.1234, lng: 0 });
  assert.deepEqual(parseManualCoordinates('-90', '180'), { lat: -90, lng: 180 });
});

test('invalid and out-of-range coordinates are rejected', () => {
  for (const [latitude, longitude] of [['NaN', '11'], ['48', 'Infinity'], ['90.01', '0'], ['0', '-180.01'], ['48,1,2', '11'], ['-', '11']]) {
    assert.equal(parseManualCoordinates(latitude, longitude), null);
  }
});
