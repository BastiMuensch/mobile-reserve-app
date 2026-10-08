import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createYearExportWorkbook, type YearExportRequest } from '../src/lib/yearExport';

test('annual exports preserve cancelled evidence but exclude it from active hours and reserve summaries', async () => {
  const base: YearExportRequest = {
    date: '2026-10-08', endDate: null, school: { name: 'Testschule' }, schoolType: 'GRUNDSCHULE',
    weeklyHours: 4, hours: 4, priority: 'OTHER', status: 'FILLED', substitutedTeacher: 'Test',
    className: '3a', comments: null, assignments: [],
  };
  const assignments = ['ACCEPTED', 'PENDING', 'REJECTED'].map((status, index) => ({
    date: `2026-10-${String(8 + index).padStart(2, '0')}`, hours: index + 2, status,
    teacher: { name: `Reserve ${status}` },
  }));
  const workbook = new ExcelJS.Workbook();
  const bytes = await createYearExportWorkbook({ requests: [
    { ...base, assignments }, { ...base, status: 'CANCELLED', assignments },
  ] });
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  const requests = workbook.getWorksheet('Anforderungen')!;
  const deployments = workbook.getWorksheet('Einsätze')!;
  assert.equal(requests.getCell('J2').value, 'Reserve ACCEPTED, Reserve PENDING');
  assert.equal(requests.getCell('J3').value, '–', 'cancelled requests have no actively assigned reserves');
  assert.equal(requests.getCell('K3').value, '–', 'cancelled requests have no active deployment dates');
  assert.equal(requests.getCell('L3').value, '3a', 'the class remains available as historical evidence');
  assert.deepEqual([2, 3, 4].map(row => deployments.getCell(`F${row}`).value), [2, 3, 0]);
  assert.deepEqual([5, 6, 7].map(row => deployments.getCell(`F${row}`).value), [0, 0, 0]);
  assert.deepEqual([5, 6, 7].map(row => deployments.getCell(`D${row}`).value), [2, 3, 4], 'original hours remain available as evidence');
  assert.deepEqual([5, 6, 7].map(row => deployments.getCell(`E${row}`).value), Array(3).fill('Anforderung storniert'));
});
