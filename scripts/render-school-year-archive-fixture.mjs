// Synthetic PDF QA only. Run with node --import tsx; never connects to a database.
import { mkdir, writeFile } from 'node:fs/promises';
import { buildSchoolYearArchiveFiles } from '../src/lib/schoolYearArchiveData.ts';

const output = 'tmp/pdfs/school-year-archive';
await mkdir(output, { recursive: true });
const date = new Date('2026-05-11T10:00:00Z');
const profile = { headerText: 'Staatliches Schulamt Sonnenhain', returnAddress: 'Schulamt Sonnenhain · Musterweg 1 · 87700 Sonnenhain',
  contactAddress: 'Musterweg 1\n87700 Sonnenhain', contactPerson: 'Sachgebiet Mobile Reserve\nTelefon: 0000 00000', city: 'Sonnenhain',
  documentSubject: 'Verwendung als mobile Reserve innerhalb des Schulamtsbereiches', documentIntro: 'Zur Verwendung als mobile Reserve werden Sie wie folgt eingesetzt:',
  documentClosing: 'Mit freundlichen Grüßen', amtsleitungName: 'Maria Musterfrau', amtsleitungTitle: 'Schulamtsdirektorin', logoUrl: null, signatureUrl: null };
for (const [index, status] of ['ACCEPTED', 'PENDING', 'REJECTED'].entries()) {
  const data = { schulamtId: 'qa-office', schoolYear: '2025/2026', snapshotAt: '2026-09-01T10:00:00Z',
    period: { start: new Date('2025-08-31T22:00:00Z'), end: new Date('2026-08-31T21:59:59Z') },
    profile, branding: { logo: null, signature: null }, reports: [], warnings: ['Synthetische Testdaten – kein amtlicher Nachweis.'],
    requests: [{ id: `qa-request-${index}`, date, endDate: null, status: status === 'REJECTED' ? 'CANCELLED' : 'FILLED',
      school: { name: 'Grundschule am Musterwald', address: 'Schulweg 7, 87700 Sonnenhain' }, schoolType: 'GRUNDSCHULE', hours: 5, weeklyHours: 0,
      priority: 'UNPLANNED_ABSENCE', substitutedTeacher: '*** gelöscht (DSGVO) ***', comments: null,
      assignments: [{ id: `qa-assignment-${index}`, requestId: `qa-request-${index}`, teacherId: `qa-teacher-${index}`, date, hours: 5, status,
        teacher: { id: `qa-teacher-${index}`, name: 'Anna Beispiel', address: 'Beispielstraße 12, 87700 Sonnenhain', gender: 'FEMALE',
          stammschule: { name: 'Mittelschule Sonnenhain', address: 'Musterplatz 4, 87700 Sonnenhain' } } }] }] };
  const result = await buildSchoolYearArchiveFiles(data);
  const pdf = result.files.find(file => file.path.endsWith('.pdf'));
  if (!pdf) throw new Error('Expected synthetic proof');
  await writeFile(`${output}/${status}.pdf`, pdf.data);
  console.log(`${output}/${status}.pdf`);
}
