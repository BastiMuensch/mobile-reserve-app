import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { dailyDeployments } from '../src/lib/dailyDeploymentList';
import { createDailyDeploymentWorkbook } from '../src/lib/dailyDeploymentExport';
import type { RequestData, TeacherData } from '../src/types/models';

const assignment = (id: string, date: string, status = 'ACCEPTED') => ({ id, date: `${date}T00:00:00.000Z`, status, requestId: 'r', teacherId: 't', hours: 3 });
const teacher = { id: 't', name: 'Reserve', stammschule: { name: 'Stammschule' } } as TeacherData;
const request = { id: 'r', status: 'FILLED', school: { name: 'Einsatzschule' }, location: { name: 'Außenstelle' }, substitutedTeacher: 'Vertretene Person', assignments: [
  assignment('a', '2026-11-23'), assignment('b', '2026-11-24'),
  assignment('c', '2026-11-25', 'REJECTED'), assignment('d', '2026-11-26', 'CANCELLED'),
] } as RequestData;

test('Tagesliste zeigt aktive Einsätze und nur tatsächlich zugewiesene Zeiträume', () => {
  assert.deepEqual(dailyDeployments([request], [teacher], '2026-11-24'), [{ id: 'b', homeSchool: 'Stammschule', teacher: 'Reserve', start: '2026-11-23', end: '2026-11-24', openEnded: false, substitutedTeacher: 'Vertretene Person', school: 'Einsatzschule · Außenstelle', pending: false }]);
  assert.deepEqual(dailyDeployments([request], [teacher], '2026-11-25'), []);
  assert.deepEqual(dailyDeployments([request], [teacher], '2026-11-26'), []);
  assert.deepEqual(dailyDeployments([{ ...request, status: 'CANCELLED' }], [teacher], '2026-11-24'), []);
});

test('a later report retains the open end for earlier Berlin days only', () => {
  const lifecycleEvents = [{ createdAt: '2026-11-23T23:10:00Z', wasOpenEnded: true, previousEndDate: null }];
  const ended = { ...request, status: 'ENDED', endDate: '2026-11-24', lifecycleEvents };
  assert.equal(dailyDeployments([ended], [teacher], '2026-11-23')[0].openEnded, true);
  assert.equal(dailyDeployments([ended], [teacher], '2026-11-24')[0].openEnded, false);
  assert.equal(dailyDeployments([{ ...request, isOpenEnded: true }], [teacher], '2026-11-24')[0].openEnded, true);
});

test('Excel export stores sortable start dates and separate filterable groups', async () => {
  const [base] = dailyDeployments([request], [teacher], '2026-11-24');
  const workbook = new ExcelJS.Workbook();
  const file = await createDailyDeploymentWorkbook('2026-11-24', [
    { ...base, openEnded: true, start: '2026-09-15' },
    { ...base, start: '2026-11-23', pending: true },
    { ...base, start: '2026-11-24', substitutedTeacher: '=1+2' },
  ]);
  await workbook.xlsx.load(Uint8Array.from(file).buffer);
  const sheet = workbook.getWorksheet('SVS-Tagesliste')!;
  assert.deepEqual(sheet.getCell('B1').value, new Date('2026-11-24'));
  assert.equal(sheet.getCell('A3').value, 'Langzeitvertretungen');
  assert.deepEqual(sheet.getCell('C5').value, new Date('2026-09-15'));
  assert.match(sheet.getCell('C5').numFmt, /" -"$/);
  assert.match(sheet.getCell('C6').numFmt, /" - 24\.11\.26"$/);
  assert.match(String(sheet.getCell('D6').value), /Bestätigung ausstehend/);
  assert.equal(sheet.getCell('A8').value, 'Eintägige Vertretungen');
  assert.equal(sheet.getCell('B10').value, '=1+2');
  assert.equal(sheet.getCell('B10').type, ExcelJS.ValueType.String);
  for (const tableName of ['Langzeitvertretungen', 'EintaegigeVertretungen']) {
    const table = sheet.getTable(tableName);
    for (let column = 0; column < 5; column++) assert.equal(table.getColumn(column).filterButton, true);
  }
});

test('Tagesliste zeigt ausstehende Bestätigung und die Stammschule aus der Zuweisung', () => {
  const pendingRequest = {
    ...request, status: 'ENDED',
    assignments: [{ ...assignment('e', '2026-11-23', 'PENDING'), teacher }],
  };
  const [row] = dailyDeployments([pendingRequest], [], '2026-11-23');
  assert.equal(row.pending, true);
  assert.equal(row.teacher, 'Reserve');
  assert.equal(row.homeSchool, 'Stammschule');
});
