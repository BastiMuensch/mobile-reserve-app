import test from 'node:test';
import assert from 'node:assert/strict';
import { sameSmtpIdentity } from '../src/lib/smtpIdentity';
const original = { smtpHost: 'smtp.school.internal', smtpPort: 587, smtpUser: 'office', smtpSecure: false };
test('masked SMTP password cannot be replayed to changed host, port, user or TLS identity', () => {
  for (const change of [{ smtpHost: 'another.example' }, { smtpPort: 465 }, { smtpUser: 'another' }, { smtpSecure: true }]) {
    assert.equal(sameSmtpIdentity(original, { ...original, ...change }), false);
  }
  assert.equal(sameSmtpIdentity(null, original), false);
  assert.equal(sameSmtpIdentity(original, { ...original, smtpHost: 'SMTP.SCHOOL.INTERNAL.' }), true);
});
