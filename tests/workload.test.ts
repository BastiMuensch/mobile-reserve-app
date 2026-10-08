import assert from 'node:assert/strict';
import test from 'node:test';
import { getCurrentSchoolYear } from '../src/lib/schoolYear';
import { buildWorkloadReport, emptyWorkload, workloadCsv, workloadFor, type WorkloadTeacherInput } from '../src/lib/workload';

const assignment = (date: string, hours: number, status = 'ACCEPTED', requestStatus = 'FILLED') => ({
  date, hours, status, request: { status: requestStatus },
});
const teacher = (assignments: WorkloadTeacherInput['assignments'] = [], id = 't1', name = 'Ada Müller'): WorkloadTeacherInput => ({
  id, name, maxWeeklyHours: 28, stammschule: { name: 'Grundschule' }, assignments,
});

test('workload separates confirmed and pending teaching units and counts each assignment day once', () => {
  const [row] = buildWorkloadReport('2026/2027', [teacher([
    assignment('2026-09-14', 3), assignment('2026-09-14', 2, 'PENDING'), assignment('2026-09-15', 4),
    assignment('2026-09-16', 50, 'REJECTED'), assignment('2026-09-17', 50, 'ACCEPTED', 'CANCELLED'),
    assignment('2026-09-18', 50, 'CANCELLED'), assignment('2026-09-19', 0), assignment('2026-09-20', -3),
    assignment('2026-09-21', Number.NaN), assignment('2026-09-22', Number.POSITIVE_INFINITY),
  ])]).teachers;
  const expected = { hours: 9, accepted: 7, pending: 2, days: 2 };
  assert.deepEqual(row.total, expected);
  assert.deepEqual(workloadFor(row, 'month', '2026-09-30'), { ...expected, key: '2026-09', start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(workloadFor(row, 'week', '2026-09-20'), { ...expected, key: '2026-09-14', start: '2026-09-14', end: '2026-09-20' });
});

test('school-year bounds are inclusive and boundary weeks are clipped to the school year', () => {
  const [row] = buildWorkloadReport('2026/2027', [teacher([
    assignment('2026-08-31', 50), assignment('2026-09-01', 2),
    assignment('2027-08-31', 3, 'PENDING'), assignment('2027-09-01', 50),
  ])]).teachers;
  assert.deepEqual(row.total, { hours: 5, accepted: 2, pending: 3, days: 2 });
  assert.deepEqual(row.weeks, [
    { key: '2026-08-31', start: '2026-09-01', end: '2026-09-06', hours: 2, accepted: 2, pending: 0, days: 1 },
    { key: '2027-08-30', start: '2027-08-30', end: '2027-08-31', hours: 3, accepted: 0, pending: 3, days: 1 },
  ]);
});

test('weeks cross month and calendar-year boundaries while monthly totals stay separate and ordered', () => {
  const [row] = buildWorkloadReport('2026/2027', [teacher([
    assignment('2027-01-03', 4), assignment('2026-10-01', 3),
    assignment('2026-12-31', 2, 'PENDING'), assignment('2026-09-30', 1), assignment('2027-01-04', 5),
  ])]).teachers;
  assert.deepEqual(row.months.map(({ key, hours, days }) => ({ key, hours, days })), [
    { key: '2026-09', hours: 1, days: 1 }, { key: '2026-10', hours: 3, days: 1 },
    { key: '2026-12', hours: 2, days: 1 }, { key: '2027-01', hours: 9, days: 2 },
  ]);
  assert.deepEqual(row.weeks.map(({ key, hours, days }) => ({ key, hours, days })), [
    { key: '2026-09-28', hours: 4, days: 2 }, { key: '2026-12-28', hours: 6, days: 2 },
    { key: '2027-01-04', hours: 5, days: 1 },
  ]);
});

test('leap-day monthly periods include February 29', () => {
  const [row] = buildWorkloadReport('2023/2024', [teacher([assignment('2024-02-29', 3), assignment('2024-03-01', 2)])]).teachers;
  assert.equal(row.months[0].end, '2024-02-29');
  assert.equal(row.months[0].hours, 3);
  assert.equal(workloadFor(row, 'week', '2024-02-29').hours, 5);
});

test('German calendar dates determine grouping across midnight and daylight-saving changes, regardless of host timezone', () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = timezone;
      const [row] = buildWorkloadReport('2026/2027', [teacher([
        assignment('2026-08-31T22:30:00Z', 2), // September 1, Berlin.
        assignment('2026-10-25T00:30:00Z', 3), assignment('2026-10-25T01:30:00Z', 4), // Same day when clocks turn back.
        assignment('2027-03-28T00:30:00Z', 5), assignment('2027-03-28T01:30:00Z', 6), // Same day when clocks advance.
        assignment('2027-08-31T22:30:00Z', 100), // Already outside the school year in Berlin.
      ])]).teachers;
      assert.deepEqual(row.total, { hours: 20, accepted: 20, pending: 0, days: 3 }, timezone);
      assert.equal(row.months[0].key, '2026-09', timezone);
      assert.equal(workloadFor(row, 'week', '2026-10-25').hours, 7, timezone);
      assert.equal(workloadFor(row, 'week', '2027-03-28').hours, 11, timezone);
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('invalid assignment dates never become hours for today', () => {
  const [row] = buildWorkloadReport(getCurrentSchoolYear(), [teacher([
    assignment('not-a-date', 100), { ...assignment('2026-09-01', 200), date: new Date(Number.NaN) },
  ])]).teachers;
  assert.deepEqual(row.total, emptyWorkload());
  assert.deepEqual(row.months, []);
  assert.deepEqual(row.weeks, []);
});

test('teachers with no assignments remain visible, with independent zero totals for unoccupied periods', () => {
  const report = buildWorkloadReport('2026/2027', [teacher([], 'z', 'Zora'), teacher([], 'a', 'Anna')]);
  assert.deepEqual(report.teachers.map(row => row.id), ['a', 'z']);
  for (const row of report.teachers) {
    assert.deepEqual(row.total, emptyWorkload());
    assert.deepEqual(row.months, []);
    assert.deepEqual(row.weeks, []);
    assert.deepEqual(workloadFor(row, 'month', '2026-10-08'), emptyWorkload());
    assert.deepEqual(workloadFor(row, 'week', '2026-10-08'), emptyWorkload());
  }
  const empty = workloadFor(report.teachers[0], 'month', '2026-10-08');
  empty.hours = 100;
  assert.equal(workloadFor(report.teachers[1], 'month', '2026-10-08').hours, 0);
  assert.equal(buildWorkloadReport('2026/2027', []).teachers.length, 0);
});

test('CSV names teaching units, distinguishes confirmation status and exports the displayed totals', () => {
  const report = buildWorkloadReport('2026/2027', [teacher([assignment('2026-09-14', 3), assignment('2026-09-15', 2, 'PENDING')])]);
  const csv = workloadCsv(report, { date: '2026-09-16' });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"Geplant \(UStd\.\)";"Bestätigt \(UStd\.\)";"Bestätigung offen \(UStd\.\)"/);
  const rows = csv.split('\r\n');
  assert.equal(rows.length, 4, 'header plus school-year, selected month and selected week');
  for (const row of rows.slice(1)) {
    assert.ok(row.includes('"5";"3";"2";"2";"28"'));
    assert.ok(row.includes('keine Erfassung tatsächlich geleisteter Arbeitszeit'));
  }
  assert.ok(rows[1].includes('"Gesamt im Schuljahr";"2026-09-01";"2027-08-31"'));
  assert.ok(rows[2].includes('"Monat";"2026-09-01";"2026-09-30"'));
  assert.ok(rows[3].includes('"Woche";"2026-09-14";"2026-09-20"'));
});

test('CSV preserves zero-use teachers and zero selected periods, and honors the selected teacher', () => {
  const report = buildWorkloadReport('2026/2027', [teacher([], 'zero', 'Anna'), teacher([assignment('2026-09-14', 4)], 'busy', 'Zora')]);
  const zeroCsv = workloadCsv(report, { date: '2026-09-01', teacherId: 'zero' });
  assert.equal(zeroCsv.split('\r\n').length, 4);
  assert.ok(zeroCsv.includes('"Woche";"2026-09-01";"2026-09-06"'));
  assert.ok(zeroCsv.split('\r\n').slice(1).every(row => row.includes('"0";"0";"0";"0";"28"')));
  assert.ok(!zeroCsv.includes('Zora'));
  const busyCsv = workloadCsv(report, { date: '2027-08-31', teacherId: 'busy' });
  assert.ok(busyCsv.includes('"Woche";"2027-08-30";"2027-08-31";"0";"0";"0";"0"'));
  assert.equal(workloadCsv(report).split('\r\n').length, 5, 'two school-year totals plus the occupied month and week');
  assert.equal(workloadCsv(report, { date: '2026-09-01', teacherId: 'missing' }).split('\r\n').length, 1);
});

test('CSV neutralizes formula prefixes and escapes quotes, semicolons and embedded newlines in free text', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1']) {
    const csv = workloadCsv(buildWorkloadReport('2026/2027', [{ ...teacher([], 'safe', value), stammschule: { name: value } }]));
    assert.ok(csv.includes(`"'${value}";"'${value}"`), JSON.stringify(value));
  }
  const name = 'Müller; "Anna"\r\nZweite Zeile';
  const csv = workloadCsv(buildWorkloadReport('2026/2027', [teacher([], 'safe', name)]));
  assert.ok(csv.includes('"Müller; ""Anna""\r\nZweite Zeile"'));
  assert.ok(csv.includes('"0";"0";"0";"0";"28"'), 'numeric cells stay numeric-compatible');
});

test('older school years and CSV disclose possible retention gaps with a stable data timestamp', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  const recent = buildWorkloadReport('2026/2027', [teacher()], now);
  const historic = buildWorkloadReport('2025/2026', [teacher()], now);
  assert.equal(recent.generatedAt, now.toISOString());
  assert.equal(recent.retentionNotice, null);
  assert.match(historic.retentionNotice ?? '', /400 Tagen/);
  assert.match(workloadCsv(historic), /400 Tagen/);
  assert.ok(workloadCsv(recent).includes(now.toISOString()));
});
