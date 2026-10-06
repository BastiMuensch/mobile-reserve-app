import test from 'node:test';
import assert from 'node:assert/strict';
import { annualRetentionBoundary, isExpiredSchoolYear } from '../src/lib/annualDataRetention';

test('school-year retention changes only after 400 full calendar days, including Berlin midnight', () => {
  // 31 Aug 2025 + 400 days = 5 Oct 2026. Retain through that day.
  const before = annualRetentionBoundary(new Date('2026-10-05T21:59:59Z'));
  const after = annualRetentionBoundary(new Date('2026-10-05T22:00:00Z'));
  assert.equal(isExpiredSchoolYear('2024/2025', before), false);
  assert.equal(isExpiredSchoolYear('2024/2025', after), true);
  assert.equal(isExpiredSchoolYear('2025/2026', after), false);
  assert.equal(isExpiredSchoolYear('2026/2027', after), false);
  for (const malformed of ['2000/2002', 'bad', '2000']) assert.equal(isExpiredSchoolYear(malformed, after), false);
});
