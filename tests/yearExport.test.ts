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

test('annual exports retain structured demand and approved actuals separately from plan hours', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await createYearExportWorkbook({ requests: [{
    date: '2026-11-02', endDate: null, school: { name: 'GS/MS' }, schoolType: 'GS_MS',
    requestedSchoolType: 'GRUNDSCHULE', gradeLevel: 2, requiredSubject: 'Sport', weeklyHours: 5, hours: 5,
    priority: 'OTHER', status: 'FILLED', substitutedTeacher: 'Test', comments: null,
    assignments: [{ date: '2026-11-02', hours: 5, actualHours: 3, actualAdditionalMinutes: 90, status: 'ACCEPTED', teacher: { name: 'MR' } }],
  }] })).buffer);
  const requests = workbook.getWorksheet('Anforderungen')!;
  const assignments = workbook.getWorksheet('Einsätze')!;
  assert.deepEqual(['M2', 'N2', 'O2'].map(cell => requests.getCell(cell).value), ['GRUNDSCHULE', 2, 'Sport']);
  assert.equal(assignments.getCell('D2').value, 5);
  assert.equal(assignments.getCell('H2').value, 3);
  assert.equal(assignments.getCell('I2').value, 90);
});
