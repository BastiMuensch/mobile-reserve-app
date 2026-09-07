import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEmptyOptionalTeacherFields, omitBlankPassword, statusForTeacherUpdate, teacherStatusSchema, withOptionalTeacherPassword } from '../src/lib/teacherUpdate';

test('teacher edit omits an empty optional password instead of validating it as a new password', () => {
  assert.deepEqual(omitBlankPassword({ name: 'Ada', password: '' }), { name: 'Ada' });
  assert.deepEqual(omitBlankPassword({ name: 'Ada', password: 'a-real-password' }), { name: 'Ada', password: 'a-real-password' });
  assert.deepEqual(withOptionalTeacherPassword({ name: 'Ada', password: '' }), { name: 'Ada' });
  assert.deepEqual(withOptionalTeacherPassword({ name: 'Ada', password: '            ' }), { name: 'Ada', password: '            ' });
});

test('teacher edit normalizes explicit empty optional controls but preserves omitted partial fields', () => {
  assert.deepEqual(normalizeEmptyOptionalTeacherFields({ name: 'Ada', email: '', gender: '' }), {
    name: 'Ada', email: null, gender: null,
  });
  assert.deepEqual(normalizeEmptyOptionalTeacherFields({ status: 'LEAVE' }), { status: 'LEAVE' });
});

test('full teacher update preserves omitted lifecycle status and only accepts known values', () => {
  assert.equal(statusForTeacherUpdate(undefined, 'LEAVE'), 'LEAVE');
  assert.equal(statusForTeacherUpdate('ACTIVE', 'LEAVE'), 'ACTIVE');
  assert.equal(teacherStatusSchema.safeParse('NOT_A_STATUS').success, false);
});
