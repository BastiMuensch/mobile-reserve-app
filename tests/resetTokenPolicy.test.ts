import test from 'node:test';
import assert from 'node:assert/strict';
import { mayIssueAnotherResetToken } from '../src/lib/resetTokens';

test('password-reset requests retain existing valid links only up to the bounded outstanding-token cap', () => {
  assert.equal(mayIssueAnotherResetToken(0), true);
  assert.equal(mayIssueAnotherResetToken(2), true);
  assert.equal(mayIssueAnotherResetToken(3), false);
  assert.equal(mayIssueAnotherResetToken(4), false);
});
