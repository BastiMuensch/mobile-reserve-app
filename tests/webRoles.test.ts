import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebRole, WEB_ROLES } from '../src/lib/webRoles';

test('only regular instance roles may use the browser application', () => {
  assert.deepEqual(WEB_ROLES, ['SCHULAMT', 'SCHOOL', 'TEACHER']);
  assert.equal(isWebRole('SCHULAMT'), true);
  assert.equal(isWebRole('SCHOOL'), true);
  assert.equal(isWebRole('TEACHER'), true);
  assert.equal(isWebRole('ADMIN'), false);
  assert.equal(isWebRole('UNKNOWN'), false);
});
