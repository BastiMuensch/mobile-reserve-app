import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTeacherProfileRow } from '../src/lib/teacherProfileSelection';

test('self-profile selection prefers the current school-year row over a newer fallback', () => {
  const rows = [
    { schoolYear: '2027/2028', id: 'future' },
    { schoolYear: '2026/2027', id: 'current' },
    { schoolYear: '2025/2026', id: 'historic' },
  ];
  assert.equal(selectTeacherProfileRow(rows, '2026/2027')?.id, 'current');
});

test('self-profile selection uses the newest ordered row only when the current row is absent', () => {
  const rows = [{ schoolYear: '2027/2028', id: 'future' }, { schoolYear: '2025/2026', id: 'historic' }];
  assert.equal(selectTeacherProfileRow(rows, '2026/2027')?.id, 'future');
  assert.equal(selectTeacherProfileRow([], '2026/2027'), undefined);
});
