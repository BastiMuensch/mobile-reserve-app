import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentCoordinates, deploymentSchool, deploymentSchoolName, type SchoolLocationData } from '../src/lib/schoolLocations';
import { SchoolLocationSchema } from '../src/lib/schoolLocationValidation';
import { requestAttemptFingerprint } from '../src/lib/requestIdempotency';
import { buildBatchProposal, type BatchRequest } from '../src/lib/batchMatching';
import { rankCandidates } from '../src/lib/matching';

const school = { id: 'school', name: 'Testschule', address: 'Hauptstraße 1', latitude: 48, longitude: 11,
  generalInfo: 'Hauptsekretariat', imageUrl: '/uploads/main.png', pinLat: 48, pinLng: 11, entranceLat: 48, entranceLng: 11, parkingLat: 48, parkingLng: 11 };
const location: SchoolLocationData = { id: 'branch', schoolId: school.id, name: 'Außenstelle West', address: 'Weststraße 20', latitude: 49, longitude: 12,
  generalInfo: null, imageUrl: null, entranceLat: null, entranceLng: null, parkingLat: null, parkingLng: null, isActive: true };
const request: BatchRequest = { id: 'demand', schoolId: school.id, date: new Date('2026-10-05T00:00:00Z'), hours: 2, weeklyHours: 2,
  startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Test', status: 'PENDING' };
const teacher = { id: 'near-main', name: 'Reserve', status: 'ACTIVE', stammschuleId: school.id, onlyStammschule: true,
  maxWeeklyHours: 28, isPartTime: false, qualifications: '', preferredType: 'BOTH', homeLat: 48, homeLng: 11, schoolYear: '2026/2027', assignments: [],
  qualificationType: null, canTeachSports: null, email: null, phone: null, userId: null, schedule: null, gender: null, address: '', postalCode: '' };

test('branches use only their own arrival data and retain organizational identity', () => {
  const destination = deploymentSchool(school, location);
  assert.equal(destination.id, school.id);
  assert.equal(destination.address, location.address);
  assert.equal(destination.name, 'Testschule · Außenstelle West');
  for (const field of ['generalInfo', 'imageUrl', 'pinLat', 'pinLng', 'entranceLat', 'entranceLng', 'parkingLat', 'parkingLng'] as const) assert.equal(destination[field], null);
  assert.deepEqual(deploymentSchool(school, null), school);
  const inactiveLocation = { ...location, isActive: false };
  assert.equal(deploymentSchoolName({ school, location: inactiveLocation }), 'Testschule · Außenstelle West');
  assert.deepEqual(deploymentCoordinates(school, { locationId: 'missing-relation' }), { latitude: null, longitude: null });
});

test('site validation rejects partial coordinates, out-of-range pins and parking without entrance', () => {
  const base = { schoolId: 'fc9f7860-9403-4ee2-ac20-0c0bd6ebcf0a', name: 'Außenstelle', address: 'Weststraße 20' };
  assert.equal(SchoolLocationSchema.safeParse(base).success, true);
  for (const fields of [{ latitude: 49 }, { latitude: 91, longitude: 12 }, { entranceLat: 49 }, { parkingLat: 49, parkingLng: 12 }]) {
    assert.equal(SchoolLocationSchema.safeParse({ ...base, ...fields }).success, false);
  }
});

test('single and automatic matching rank distance to the branch while allowing home-school-only reserves', () => {
  const teachers = [teacher, { ...teacher, id: 'near-branch', homeLat: 49, homeLng: 12 }];
  const rank = (site: SchoolLocationData | null) => rankCandidates(
    { ...request, locationId: site?.id ?? null, location: site } as Parameters<typeof rankCandidates>[0],
    school as Parameters<typeof rankCandidates>[1], teachers,
  );
  assert.equal(rank(null)[0].id, 'near-main');
  assert.equal(rank(location)[0].id, 'near-branch');
  assert.equal(rank(location)[0].distanceToSchool, 0);
  const batch = (site: SchoolLocationData | null) => buildBatchProposal({ today: new Date('2026-10-05T00:00:00Z'), until: '2026-10-05',
    schools: [school], teachers, requests: [{ ...request, locationId: site?.id ?? null, location: site }], absences: [], leavePeriods: [] });
  assert.equal(batch(null)[0].proposals[0].segments[0].teacherId, 'near-main');
  assert.equal(batch(location)[0].proposals[0].segments[0].teacherId, 'near-branch');
  assert.equal(batch({ ...location, latitude: null, longitude: null })[0].proposals.length, 0);
});

test('request retries distinguish branch selection without changing historic main-site hashes', () => {
  const attempt = { schoolId: school.id, date: new Date('2026-10-05'), endDate: null, priority: 'UNPLANNED_ABSENCE', startHour: 1,
    hours: 2, weeklyHours: 2, schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Test', schedule: null, qualifications: '', comments: null, isOpenEnded: false };
  assert.equal(requestAttemptFingerprint(attempt), requestAttemptFingerprint({ ...attempt, locationId: null }));
  assert.notEqual(requestAttemptFingerprint(attempt), requestAttemptFingerprint({ ...attempt, locationId: location.id }));
  assert.notEqual(requestAttemptFingerprint({ ...attempt, locationId: 'one' }), requestAttemptFingerprint({ ...attempt, locationId: 'two' }));
});
