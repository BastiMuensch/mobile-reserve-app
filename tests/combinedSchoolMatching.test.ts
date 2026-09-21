import assert from 'node:assert/strict';
import test from 'node:test';
import { baseMatchScore, SCORE_PREFERRED_TYPE, SCORE_WRONG_TYPE } from '../src/lib/matching';

test('combined schools do not penalize either school preference', () => {
  const input = { isStammschule: false, hasAllQuals: true, distance: 9, requestedSchoolType: 'GS_MS' };
  const neutral = baseMatchScore({ ...input, preferredType: 'BOTH' });
  for (const preferredType of ['GRUNDSCHULE', 'MITTELSCHULE']) {
    assert.equal(baseMatchScore({ ...input, preferredType }), neutral);
    assert.equal(baseMatchScore({ ...input, preferredType, requestedSchoolType: preferredType }), neutral + SCORE_PREFERRED_TYPE);
    const otherType = preferredType === 'GRUNDSCHULE' ? 'MITTELSCHULE' : 'GRUNDSCHULE';
    assert.equal(baseMatchScore({ ...input, preferredType, requestedSchoolType: otherType }), neutral + SCORE_WRONG_TYPE);
  }
});
