import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildSchoolYearArchiveFiles, groupArchiveAssignments, type SchoolYearArchiveData } from '../src/lib/schoolYearArchiveData';
import { createHash } from 'node:crypto';
import { getAssignmentSeries } from '../src/lib/assignmentSeries';

const day = new Date('2026-05-11T00:00:00.000Z');
function fixture(): SchoolYearArchiveData {
  return {
    schulamtId: 'office-1', schoolYear: '2025/2026', snapshotAt: '2026-09-01T00:00:00.000Z',
    period: { start: new Date('2025-09-01T00:00:00.000Z'), end: new Date('2026-08-31T23:59:59.999Z') },
    profile: { headerText: 'Schulamt', returnAddress: 'Weg 1', contactAddress: 'Weg 1', contactPerson: 'Leitung', city: 'Berlin',
      documentSubject: 'Einsatz', documentIntro: 'Sie werden eingesetzt.', documentClosing: 'Gruß', amtsleitungName: 'Leitung', amtsleitungTitle: 'Amt', logoUrl: null, signatureUrl: null },
    branding: { logo: null, signature: null }, warnings: ['Testhinweis'], reports: [],
    requests: [{ id: 'request-1', date: day, endDate: null, school: { name: '=Formelschule', address: 'Schulweg 2' }, schoolType: 'GRUNDSCHULE', weeklyHours: 3, hours: 3,
      priority: 'UNPLANNED_ABSENCE', status: 'PENDING', substitutedTeacher: 'Vertretung', comments: '=HYPERLINK()', assignments: [{ id: 'assignment-1', teacherId: 'teacher-1', date: day, hours: 3, status: 'PENDING',
        teacher: { id: 'teacher-1', name: 'Max Mustermann', address: 'Straße 3', gender: 'MALE', stammschule: { name: 'Stammschule', address: 'Stammweg 4' } } }] }],
  };
}

test('school-year archive renderer creates deterministic safe paths, an annual workbook and a marked pending proof', async () => {
  const result = await buildSchoolYearArchiveFiles(fixture());
  assert.deepEqual(result.files.map(file => file.path).sort(), [
    'Einsatznachweise/Max_Mustermann--teacher-1/VORLAEUFIG_2026-05-11--request-1--assignment-1.pdf', 'Inhaltsverzeichnis.html', 'Jahresuebersicht.xlsx', 'Pruefbericht.json',
  ]);
  assert.equal(result.summary.requestCount, 1); assert.equal(result.summary.assignmentCount, 1); assert.equal(result.summary.proofCount, 1);
  const annual = result.files.find(file => file.path === 'Jahresuebersicht.xlsx')!;
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(annual.data.buffer as ArrayBuffer);
  assert.equal(workbook.getWorksheet('Anforderungen')!.getCell('C2').value, "'=Formelschule");
  const proof = Buffer.from(result.files.find(file => file.path.startsWith('Einsatznachweise/'))!.data).toString('latin1');
  assert.match(proof, /%PDF/);
  assert.match(new TextDecoder().decode(result.files.find(file => file.path === 'Inhaltsverzeichnis.html')!.data), /Testhinweis/);
});

test('cancelled requests with an active assignment produce an anomaly warning and no valid proof', async () => {
  const data = fixture(); data.requests[0].status = 'CANCELLED'; data.requests[0].assignments[0].status = 'ACCEPTED';
  const result = await buildSchoolYearArchiveFiles(data);
  assert.equal(result.summary.proofCount, 0);
  assert.ok(result.summary.warnings.some(warning => warning.includes('kein gültiger Einsatznachweis')));
});

test('manifest checksums match actual files and warning HTML is escaped', async () => {
  const data = fixture(); data.warnings = ['<script>alert("test")</script>'];
  const result = await buildSchoolYearArchiveFiles(data);
  const index = new TextDecoder().decode(result.files.find(file => file.path === 'Inhaltsverzeichnis.html')!.data);
  assert.ok(!index.includes('<script>'));
  assert.ok(index.includes('&lt;script&gt;'));
  const report = JSON.parse(new TextDecoder().decode(result.files.find(file => file.path === 'Pruefbericht.json')!.data));
  for (const entry of report.files) {
    const actual = result.files.find(file => file.path === entry.path)!;
    assert.equal(entry.bytes, actual.data.byteLength);
    assert.equal(entry.sha256, createHash('sha256').update(actual.data).digest('hex'));
  }
});

test('linear grouping preserves existing series semantics and handles large long-running requests', () => {
  const source = fixture().requests[0].assignments[0];
  const rows = Array.from({ length: 50_000 }, (_, n) => ({ ...source, id: String(n), teacherId: String(n % 100),
    date: new Date(Date.UTC(2025, 8, 1 + Math.floor(n / 100))), status: n % 127 === 0 ? 'REJECTED' : 'ACCEPTED' }));
  const started = performance.now();
  const groups = groupArchiveAssignments(rows);
  assert.equal(groups.reduce((n, group) => n + group.length, 0), 50_000);
  assert.equal(new Set(groups.flatMap(group => group.map(row => row.id))).size, 50_000);
  assert.ok(performance.now() - started < 5000, '50k rows should group within a bounded runtime');
  const sample = rows.filter(row => row.teacherId === '0');
  for (const group of groupArchiveAssignments(sample)) {
    assert.deepEqual(group.map(row => row.id), getAssignmentSeries(group[0], sample).map(row => row.id));
  }
});

test('proof paths cannot collide across requests and a mixed pending series is visibly provisional', async () => {
  const data = fixture();
  data.requests[0].status = 'FILLED'; data.requests[0].assignments[0].status = 'ACCEPTED';
  data.requests[0].assignments.push({ ...data.requests[0].assignments[0], id: 'assignment-2', date: new Date('2026-05-12T00:00:00.000Z'), status: 'PENDING' });
  data.requests.push({ ...data.requests[0], id: 'request-2', assignments: [{ ...data.requests[0].assignments[0], id: 'assignment-3' }] });
  const result = await buildSchoolYearArchiveFiles(data);
  const proofs = result.files.filter(file => file.path.startsWith('Einsatznachweise/')).map(file => file.path).sort();
  assert.equal(proofs.length, 2);
  assert.ok(proofs.some(path => path.includes('VORLAEUFIG_') && path.includes('--request-1--assignment-1')));
  assert.ok(proofs.some(path => path.includes('--request-2--assignment-3')));
});
