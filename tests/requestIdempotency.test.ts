import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesRequestIdempotencyFingerprint, requestAttemptFingerprint, requestIdempotencyKeySchema } from '../src/lib/requestIdempotency';

test('request idempotency accepts one UUID per submission attempt', () => {
  assert.equal(requestIdempotencyKeySchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success, true);
  assert.equal(requestIdempotencyKeySchema.safeParse('not-a-request-key').success, false);
});

test('independent identical requests can use distinct idempotency keys', () => {
  const first = '550e8400-e29b-41d4-a716-446655440000';
  const independentAttempt = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  assert.notEqual(first, independentAttempt);
  assert.equal(requestIdempotencyKeySchema.parse(first), first);
  assert.equal(requestIdempotencyKeySchema.parse(independentAttempt), independentAttempt);
});

test('idempotency fingerprint is stable for the normalized payload and rejects changed effective data', () => {
  const attempt = {
    schoolId: 'school-1',
    date: new Date('2026-10-01T00:00:00.000Z'),
    endDate: null,
    priority: 'UNPLANNED_ABSENCE',
    startHour: 1,
    hours: 4,
    weeklyHours: 4,
    schoolType: 'GRUNDSCHULE',
    substitutedTeacher: 'Frau Test',
    schedule: null,
    qualifications: 'Grundschule',
    comments: 'Parkplatz hinten',
    isOpenEnded: false,
  };
  const fingerprint = requestAttemptFingerprint(attempt);
  assert.equal(fingerprint, requestAttemptFingerprint({ ...attempt }));
  assert.notEqual(fingerprint, requestAttemptFingerprint({ ...attempt, comments: 'Parkplatz vorne' }));
  assert.equal(matchesRequestIdempotencyFingerprint(fingerprint, fingerprint), true);
  assert.equal(matchesRequestIdempotencyFingerprint(fingerprint, requestAttemptFingerprint({ ...attempt, comments: 'Parkplatz vorne' })), false);
  assert.equal(matchesRequestIdempotencyFingerprint(null, fingerprint), false);
});
