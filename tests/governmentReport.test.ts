import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { calculateReportTotals, governmentReportInputSchema, suggestReportingRow, type ReportTeacher, type GovernmentReportInput } from '../src/lib/governmentReport';
import { createGovernmentReportWorkbook } from '../src/lib/governmentReportExport';

const date = (day: string) => new Date(`${day}T00:00:00Z`);
function teacher(): ReportTeacher {
  return { id: 't1', name: 'Testlehrkraft', status: 'ACTIVE', maxWeeklyHours: 15, schedule: null,
    reportingPeriods: [{ effectiveFrom: date('2026-09-01'), category: 'GS_MS', included: true, weeklyHours: 15 }],
    assignments: [], absences: [], leavePeriods: [] };
}
function assignments(days: string[], open = false): ReportTeacher['assignments'] {
  return days.map(day => ({ requestId: 'r1', date: date(day), hours: 3, status: 'ACCEPTED',
    request: { status: 'FILLED', date: date('2026-09-01'), endDate: open ? null : date('2026-12-31'), isOpenEnded: open } }));
}
const weekDays = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-28'];

test('headcount includes temporary illness, excludes specialist teachers and permanent unavailability, hours are capacity', () => {
  const sick = teacher(); sick.absences = [{ date: date('2026-09-15') }];
  const deployed = teacher(); deployed.id = 't2'; deployed.assignments = assignments(['2026-09-15']);
  const eg = teacher(); eg.id = 'eg'; eg.reportingPeriods[0].category = 'EG';
  const mt = teacher(); mt.id = 'mt'; mt.reportingPeriods[0].category = 'MT';
  const excluded = teacher(); excluded.id = 'out'; excluded.reportingPeriods[0].included = false;
  const rows = [sick, deployed, eg, mt, excluded].map(t => suggestReportingRow(t, '2026-09-15'));
  assert.equal(rows[0].state, 'UNAVAILABLE');
  assert.deepEqual(calculateReportTotals(rows), { people: 2, hours: 30, long: 0, short: 1, deployed: 1, idle: 1, ready: 0 });
});

test('effective dates retain prior availability and hours, including a later return', () => {
  const t = teacher();
  t.reportingPeriods.push({ effectiveFrom: date('2026-10-01'), category: 'GS_MS', included: false, weeklyHours: 15 });
  t.reportingPeriods.push({ effectiveFrom: date('2026-11-01'), category: 'GS_MS', included: true, weeklyHours: 10 });
  assert.equal(calculateReportTotals([suggestReportingRow(t, '2026-09-30')]).hours, 15);
  assert.equal(calculateReportTotals([suggestReportingRow(t, '2026-10-01')]).people, 0);
  assert.equal(calculateReportTotals([suggestReportingRow(t, '2026-11-01')]).hours, 10);
  t.status = 'LEAVE';
  assert.equal(calculateReportTotals([suggestReportingRow(t, '2026-09-30')]).people, 1, 'undated current flags must not rewrite history');
});

test('28 days are short, 29 days long; known duration counts immediately, open-ended horizon does not', () => {
  const t = teacher();
  t.assignments = assignments(weekDays);
  assert.equal(suggestReportingRow(t, '2026-09-01').state, 'SHORT');
  t.assignments = assignments([...weekDays, '2026-09-29']);
  assert.equal(suggestReportingRow(t, '2026-09-01').state, 'LONG');
  t.assignments = assignments([...weekDays, '2026-09-29'], true);
  assert.equal(suggestReportingRow(t, '2026-09-01').state, 'SHORT');
  assert.equal(suggestReportingRow(t, '2026-09-28').state, 'SHORT');
  assert.equal(suggestReportingRow(t, '2026-09-29').state, 'LONG');
});

test('request age, cancelled assignments, distinct teachers and gaps never establish a long personal deployment', () => {
  const t = teacher();
  t.assignments = assignments(['2026-09-29']);
  assert.equal(suggestReportingRow(t, '2026-09-29').state, 'SHORT');
  t.assignments = assignments(['2026-09-01', '2026-09-29']);
  assert.equal(suggestReportingRow(t, '2026-09-29').state, 'SHORT');
  t.assignments = assignments([...weekDays, '2026-09-29']);
  t.assignments.at(-1)!.status = 'REJECTED';
  assert.equal(suggestReportingRow(t, '2026-09-29').state, 'READY');
  t.assignments = assignments([...weekDays, '2026-09-29']).map(a => ({ ...a, request: { ...a.request, status: 'CANCELLED' } }));
  assert.equal(suggestReportingRow(t, '2026-09-01').state, 'READY');
});

test('mixed deployments count a person exactly once and expose the choice for review', () => {
  const t = teacher(); t.assignments = assignments([...weekDays, '2026-09-29']);
  t.assignments.push({ ...assignments(['2026-09-01'])[0], requestId: 'r2' });
  const row = suggestReportingRow(t, '2026-09-01');
  assert.equal(row.state, 'LONG'); assert.ok(row.notes.some(n => n.includes('einmal')));
  assert.equal(calculateReportTotals([row]).deployed, 1);
});

test('leave does not automatically mean permanent exclusion, unclassified teachers need confirmation', () => {
  const t = teacher(); t.reportingPeriods = [];
  t.leavePeriods = [{ startDate: date('2026-09-01'), endDate: null }];
  const row = suggestReportingRow(t, '2026-09-10');
  assert.equal(row.setting.category, 'UNKNOWN'); assert.equal(row.setting.included, true); assert.equal(row.state, 'UNAVAILABLE');
});

function report(): GovernmentReportInput {
  return { date: '2026-09-15', office: 'UAM', internalShort: 0, internalLong: 2, reviewed: true, expectedUpdatedAt: null,
    entries: [suggestReportingRow(teacher(), '2026-09-15')].map(({ teacherId, setting, state }) => ({ teacherId, setting, state })) };
}
test('review requires explicit zero/manual counts, known categories, unique IDs and valid effective dates', () => {
  const input = report();
  assert.ok(governmentReportInputSchema.safeParse(input).success);
  assert.equal(governmentReportInputSchema.safeParse({ ...input, internalShort: null }).success, false);
  assert.equal(governmentReportInputSchema.safeParse({ ...input, date: '2026-02-30' }).success, false);
  assert.equal(governmentReportInputSchema.safeParse({ ...input, entries: [...input.entries, ...input.entries] }).success, false);
  input.entries[0].setting.effectiveFrom = '2026-09-16';
  assert.equal(governmentReportInputSchema.safeParse(input).success, false);
  input.entries[0].setting.effectiveFrom = '2026-08-31';
  assert.equal(governmentReportInputSchema.safeParse(input).success, false);
  input.entries[0].setting.effectiveFrom = '2026-09-15'; input.entries[0].setting.category = 'UNKNOWN';
  assert.equal(governmentReportInputSchema.safeParse(input).success, false);
  input.reviewed = false;
  assert.ok(governmentReportInputSchema.safeParse(input).success, 'incomplete drafts can be saved');
});

test('Excel matches government sheet and cell mapping, contains aggregate data only and refuses drafts', async () => {
  const input = report();
  const buffer = await createGovernmentReportWorkbook(input);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.getWorksheet('Vertretungssituation')!;
  assert.equal(sheet.getCell('A8').value, 'UAM'); assert.deepEqual(sheet.getCell('B8').value, date('2026-09-15'));
  assert.deepEqual(['C8', 'D8', 'E8', 'F8', 'G8', 'H8', 'I8', 'J8', 'K8'].map(c => sheet.getCell(c).value), [1, 15, 0, 0, 0, 1, 1, 0, 2]);
  assert.equal(sheet.pageSetup.printArea, 'A1:K8');
  assert.ok(!JSON.stringify(sheet.getSheetValues()).includes('Testlehrkraft'));
  await assert.rejects(() => createGovernmentReportWorkbook({ ...input, reviewed: false }));
  const hostile = { ...input, office: '=WEBSERVICE("https://example.com")' };
  const textBook = new ExcelJS.Workbook(); await textBook.xlsx.load(await createGovernmentReportWorkbook(hostile));
  assert.equal(textBook.worksheets[0].getCell('A8').type, ExcelJS.ValueType.String, 'free text stays an XLSX string, never a formula');
});
