import assert from 'node:assert/strict';
import test from 'node:test';
import { schoolYearForExportMonth } from '../src/lib/teacherExport';

test('monthly export resolves the school year from the selected month', () => {
  assert.equal(schoolYearForExportMonth(2026, 8), '2025/2026');
  assert.equal(schoolYearForExportMonth(2026, 9), '2026/2027');
});
