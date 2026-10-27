import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveSchoolDistrictFilter, matchesSchoolDistrict, schoolDistrictOptions, schoolDistrictSchema } from '../src/lib/schoolDistrict';
import { privacyAcknowledgementSchema, registrationPrivacyNotice } from '../src/lib/registrationPrivacy';

test('districts normalize input, permit other offices, and reject oversized values', () => {
  assert.equal(schoolDistrictSchema.parse(' btL '), 'BTL');
  assert.equal(schoolDistrictSchema.parse(''), null);
  assert.equal(schoolDistrictSchema.parse(null), null);
  assert.equal(schoolDistrictSchema.parse(' kul '), 'KUL');
  assert.equal(schoolDistrictSchema.safeParse('a'.repeat(51)).success, false);
});

test('district filtering never treats unassigned records as belonging to a district', () => {
  for (const value of [null, undefined, 'BT', 'BTL']) assert.ok(matchesSchoolDistrict(value, 'ALL'));
  assert.ok(matchesSchoolDistrict(null, 'UNASSIGNED'));
  assert.ok(matchesSchoolDistrict(undefined, 'UNASSIGNED'));
  assert.ok(matchesSchoolDistrict('BT', 'BT'));
  assert.ok(matchesSchoolDistrict('ALL', 'district:ALL'));
  assert.equal(matchesSchoolDistrict('BT', 'district:ALL'), false);
  assert.equal(matchesSchoolDistrict('BTL', 'BT'), false);
  assert.equal(matchesSchoolDistrict(null, 'BT'), false);
  assert.equal(matchesSchoolDistrict('BT', 'UNASSIGNED'), false);
  assert.deepEqual(schoolDistrictOptions([]), []);
  assert.deepEqual(schoolDistrictOptions(['NORD', null, 'SÜD', 'NORD']), ['NORD', 'SÜD']);
  assert.deepEqual(schoolDistrictOptions(['BT', 'KUL', null, undefined, 'BTL', 'KUL']), ['BT', 'BTL', 'KUL']);
});

test('privacy acknowledgement requires explicit true and versions the actual displayed policy', () => {
  const notice = registrationPrivacyNotice('Unsere Datenschutzerklärung');
  assert.ok(notice.text.includes('Unsere Datenschutzerklärung'));
  assert.deepEqual(notice, registrationPrivacyNotice('Unsere Datenschutzerklärung'));
  assert.notEqual(notice.version, registrationPrivacyNotice('Geänderte Datenschutzerklärung').version);
  for (const privacyAccepted of [undefined, false, 'true', 1]) {
    assert.equal(privacyAcknowledgementSchema.safeParse({ privacyAccepted, privacyVersion: notice.version }).success, false);
  }
  assert.ok(privacyAcknowledgementSchema.safeParse({ privacyAccepted: true, privacyVersion: notice.version }).success);
  assert.equal(privacyAcknowledgementSchema.safeParse({ privacyAccepted: true }).success, false);
});


test('district filtering is opt-in and disabling removes an existing selection from the result', () => {
  assert.equal(effectiveSchoolDistrictFilter('NORD', undefined), 'ALL');
  assert.equal(effectiveSchoolDistrictFilter('NORD', false), 'ALL');
  assert.equal(effectiveSchoolDistrictFilter('NORD', true), 'NORD');
  assert.ok(matchesSchoolDistrict('SÜD', effectiveSchoolDistrictFilter('NORD', false)));
});
