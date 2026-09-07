import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSchoolNavigationPoints, validateSchoolNavigationPoints } from '../src/lib/schoolNavigation';

test('navigation points require complete coordinate pairs', () => {
  assert.match(validateSchoolNavigationPoints({ entranceLat: 48.1 }) ?? '', /paarweise/);
  assert.match(validateSchoolNavigationPoints({ entranceLat: 48.1, entranceLng: 11.5, parkingLng: 11.6 }) ?? '', /Parkplatz/);
});

test('parking requires an explicit entrance and legacy pins are not inputs', () => {
  assert.match(validateSchoolNavigationPoints({ parkingLat: 48.1, parkingLng: 11.5 }) ?? '', /Eingang/);
  assert.equal(validateSchoolNavigationPoints({ entranceLat: 48.1, entranceLng: 11.5, parkingLat: 48.11, parkingLng: 11.51 }), null);
  assert.equal(validateSchoolNavigationPoints({}), null);
});

test('partial PATCH validation keeps persisted points and rejects orphaning parking', () => {
  const current = { entranceLat: 48.1, entranceLng: 11.5, parkingLat: 48.11, parkingLng: 11.51 };
  assert.deepEqual(mergeSchoolNavigationPoints(current, { entranceLat: 48.2 }), { ...current, entranceLat: 48.2 });
  const clearedEntrance = mergeSchoolNavigationPoints(current, { entranceLat: null, entranceLng: null });
  assert.match(validateSchoolNavigationPoints(clearedEntrance) ?? '', /Parkplatz/);
});
