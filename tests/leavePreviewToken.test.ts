import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeavePreviewToken } from '../src/lib/leavePreviewToken';

test('leave preview token is order-independent but binds range and assignment set', () => {
  const start = new Date('2026-10-01T00:00:00.000Z');
  const end = new Date('2026-10-03T23:59:59.999Z');
  const token = createLeavePreviewToken(['teacher-b', 'teacher-a'], start, end, ['assignment-b', 'assignment-a']);
  assert.equal(token, createLeavePreviewToken(['teacher-a', 'teacher-b'], start, end, ['assignment-a', 'assignment-b']));
  assert.notEqual(token, createLeavePreviewToken(['teacher-a', 'teacher-b'], start, end, ['assignment-a']));
  assert.notEqual(token, createLeavePreviewToken(['teacher-a', 'teacher-b'], start, null, ['assignment-a', 'assignment-b']));
});
