/**
 * Prüft die Datei-Exporte: Excel (exceljs) und PDF (jspdf).
 *
 * Lädt die Dateien über die HTTP-Schnittstelle herunter und öffnet sie anschließend
 * wieder, statt nur den Statuscode zu glauben – eine kaputte Datei wird sonst mit
 * HTTP 200 ausgeliefert und fällt erst beim Öffnen auf.
 *
 * Aufruf gegen eine WEGWERFBARE Testdatenbank:
 *   APP_URL=http://localhost:3100 \
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:55432/e2etest?schema=public" \
 *   npx tsx scratch-scripts/export-verify.ts
 */
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

const APP = process.env.APP_URL || 'http://localhost:3100';
const dbName = (process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0] ?? '';
if (!dbName.toLowerCase().includes('test')) {
  console.error(`\nABBRUCH: nur gegen eine Testdatenbank ausführen. Ziel: "${dbName}"\n`);
  process.exit(1);
}

const prisma = new PrismaClient();
const checks: [string, boolean, string?][] = [];
function pruefe(name: string, ok: boolean, detail?: string) {
  checks.push([name, ok, detail]);
  console.log(`   ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail && !ok ? ' — ' + detail : ''}`);
}

async function anmelden(email: string, password: string): Promise<string> {
  const r = await fetch(`${APP}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`Anmeldung fehlgeschlagen: ${email} (${r.status})`);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

/** Öffnet die heruntergeladene Arbeitsmappe wirklich und liest sie aus. */
async function leseExcel(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

(async () => {
  const schulamt = await anmelden('admin@schulamt-musterstadt.de', 'musterstadt123');
  const lehrkraft = await anmelden('lehrkraft@musterstadt.de', 'lehrkraft123');
  const teacher = await prisma.teacher.findFirstOrThrow({ where: { name: 'Lukas Sonnenschein' } });
  const school = await prisma.school.findFirstOrThrow({ where: { name: 'Grundschule am Marktplatz' } });

  // Ein abgeschlossener Einsatz, damit die Exporte etwas zu berichten haben.
  const tag = new Date(); tag.setDate(tag.getDate() - 3); tag.setHours(12, 0, 0, 0);
  const req = await prisma.request.create({
    data: {
      schoolId: school.id, date: tag, hours: 4, weeklyHours: 4, startHour: 1,
      substitutedTeacher: 'Frau Exporttest', qualifications: 'Grundschule',
      comments: 'Export-Prüfung', status: 'FILLED', schoolType: 'GRUNDSCHULE',
    },
  });
  await prisma.assignment.create({
    data: { requestId: req.id, teacherId: teacher.id, date: tag, hours: 4, status: 'ACCEPTED' },
  });

  console.log('\n=== 1. Excel: Gesamtübersicht des Schulamts ===');
  const r1 = await fetch(`${APP}/api/export`, { headers: { Cookie: schulamt } });
  pruefe('Antwort ist erfolgreich', r1.ok, `Status ${r1.status}`);
  pruefe('Dateityp ist eine Arbeitsmappe',
    (r1.headers.get('content-type') ?? '').includes('spreadsheetml'), r1.headers.get('content-type') ?? '');
  const b1 = Buffer.from(await r1.arrayBuffer());
  pruefe('Datei ist nicht leer', b1.length > 1000, `${b1.length} Bytes`);
  pruefe('Beginnt mit der ZIP-Signatur einer xlsx-Datei', b1[0] === 0x50 && b1[1] === 0x4b);
  try {
    const wb = await leseExcel(b1);
    const ws = wb.getWorksheet('Anforderungen');
    pruefe('Arbeitsmappe lässt sich öffnen', true);
    pruefe('Blatt "Anforderungen" existiert', !!ws);
    const kopf = ws?.getRow(1).values as string[] | undefined;
    pruefe('Kopfzeile enthält die erwarteten Spalten',
      !!kopf && kopf.includes('Schule') && kopf.includes('Datum') && kopf.includes('Status'),
      JSON.stringify(kopf?.slice(1, 5)));
    pruefe('Enthält Datenzeilen', (ws?.rowCount ?? 0) > 1, `${ws?.rowCount} Zeilen`);
    const inhalt = JSON.stringify(ws?.getSheetValues());
    pruefe('Der Testeinsatz taucht auf', inhalt.includes('Grundschule am Marktplatz'));
  } catch (e) {
    pruefe('Arbeitsmappe lässt sich öffnen', false, (e as Error).message);
  }

  console.log('\n=== 2. Excel: Einsätze einer Lehrkraft ===');
  const r2 = await fetch(`${APP}/api/teachers/${teacher.id}/export`, { headers: { Cookie: schulamt } });
  pruefe('Antwort ist erfolgreich', r2.ok, `Status ${r2.status}`);
  const b2 = Buffer.from(await r2.arrayBuffer());
  pruefe('Datei ist nicht leer', b2.length > 1000, `${b2.length} Bytes`);
  try {
    const wb = await leseExcel(b2);
    pruefe('Blatt "Einsätze" existiert', !!wb.getWorksheet('Einsätze'));
    pruefe('Enthält Datenzeilen', (wb.getWorksheet('Einsätze')?.rowCount ?? 0) > 1);
  } catch (e) {
    pruefe('Arbeitsmappe lässt sich öffnen', false, (e as Error).message);
  }

  console.log('\n=== 3. Formeln in Zellen werden entschärft ===');
  const boese = await prisma.request.create({
    data: {
      schoolId: school.id, date: tag, hours: 2, weeklyHours: 2, startHour: 1,
      substitutedTeacher: '=1+1', qualifications: 'Grundschule',
      comments: '=HYPERLINK("http://example.invalid","hier klicken")',
      status: 'PENDING', schoolType: 'GRUNDSCHULE',
    },
  });
  const r3 = await fetch(`${APP}/api/export`, { headers: { Cookie: schulamt } });
  const wb3 = await leseExcel(Buffer.from(await r3.arrayBuffer()));
  const werte = JSON.stringify(wb3.getWorksheet('Anforderungen')?.getSheetValues());
  pruefe('Führendes "=" ist neutralisiert', werte.includes("'=1+1"), 'Formel womöglich aktiv!');
  pruefe('Keine Zelle wurde als Formel abgelegt', !werte.includes('"formula"'));
  await prisma.request.delete({ where: { id: boese.id } });

  console.log('\n=== 4. PDF: Einsatznachweis ===');
  const assign = await prisma.assignment.findFirstOrThrow({ where: { requestId: req.id } });
  const r4 = await fetch(`${APP}/api/assignments/${assign.id}/pdf`, { headers: { Cookie: schulamt } });
  pruefe('Antwort ist erfolgreich', r4.ok, `Status ${r4.status}`);
  const b4 = Buffer.from(await r4.arrayBuffer());
  pruefe('Dateityp ist PDF', (r4.headers.get('content-type') ?? '').includes('pdf'));
  pruefe('Beginnt mit der PDF-Signatur', b4.subarray(0, 4).toString() === '%PDF');
  pruefe('Endet vollständig (EOF-Markierung)', b4.subarray(-1024).toString('latin1').includes('%%EOF'));
  pruefe('Datei hat plausible Größe', b4.length > 2000, `${b4.length} Bytes`);

  console.log('\n=== 5. PDF: Monatsübersicht (mit Feiertagslogik) ===');
  // Die Route erwartet das Format JJJJ-MM (so ruft es auch der Dialog in der Oberflaeche auf)
  const monat = `${tag.getFullYear()}-${String(tag.getMonth() + 1).padStart(2, '0')}`;
  const r5 = await fetch(`${APP}/api/teachers/${teacher.id}/export-monthly?month=${monat}`, { headers: { Cookie: schulamt } });
  pruefe('Antwort ist erfolgreich', r5.ok, `Status ${r5.status}`);
  const b5 = Buffer.from(await r5.arrayBuffer());
  pruefe('Beginnt mit der PDF-Signatur', b5.subarray(0, 4).toString() === '%PDF');
  pruefe('Endet vollständig (EOF-Markierung)', b5.subarray(-1024).toString('latin1').includes('%%EOF'));
  pruefe('Datei hat plausible Größe', b5.length > 2000, `${b5.length} Bytes`);

  // Ein Monat weit in der Zukunft liegt ausserhalb der gepflegten Ferientermine
  const r6 = await fetch(`${APP}/api/teachers/${teacher.id}/export-monthly?month=${tag.getFullYear() + 3}-03`, { headers: { Cookie: schulamt } });
  const b6 = Buffer.from(await r6.arrayBuffer());
  pruefe('Auch ein Monat ohne hinterlegte Ferien wird erzeugt',
    r6.ok && b6.subarray(0, 4).toString() === '%PDF', `Status ${r6.status}`);

  const r6b = await fetch(`${APP}/api/teachers/${teacher.id}/export-monthly?month=quatsch`, { headers: { Cookie: schulamt } });
  pruefe('Ungueltiger Monat wird sauber abgewiesen (HTTP 400)', r6b.status === 400, `Status ${r6b.status}`);

  console.log('\n=== 6. Berechtigungen ===');
  const r7 = await fetch(`${APP}/api/export`, { headers: { Cookie: lehrkraft } });
  pruefe('Lehrkraft darf die Gesamtübersicht nicht laden', r7.status === 401 || r7.status === 403, `Status ${r7.status}`);
  const r8 = await fetch(`${APP}/api/export`);
  pruefe('Ohne Anmeldung kein Export', r8.status === 401, `Status ${r8.status}`);

  const fehler = checks.filter(c => !c[1]).length;
  console.log(`\n${'='.repeat(52)}`);
  console.log(fehler === 0
    ? `ALLE ${checks.length} PRÜFUNGEN BESTANDEN`
    : `${fehler} von ${checks.length} PRÜFUNGEN FEHLGESCHLAGEN`);
  console.log('='.repeat(52) + '\n');
  process.exit(fehler === 0 ? 0 : 1);
})().catch(e => { console.error('\nAbbruch:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
