/**
 * Durchgängiger Funktionstest über die HTTP-Schnittstelle.
 *
 * Spielt den echten Ablauf durch und prüft nach jedem Schritt in der Datenbank nach,
 * ob tatsächlich passiert ist, was die Antwort behauptet:
 *
 *   Schule meldet Bedarf → Schulamt lässt Kandidaten ermitteln → Schulamt bucht
 *   → Lehrkraft bestätigt → Doppelbuchung wird abgewiesen → Ausfall gibt Bedarf frei
 *   → längere Abwesenheit nimmt die Lehrkraft aus der Planung
 *
 * Voraussetzung: Testdatenbank mit prisma/seed-musterstadt.ts und
 * scratch-scripts/test-setup.ts befüllt.
 *
 * Aufruf gegen eine WEGWERFBARE Testdatenbank:
 *   APP_URL=http://localhost:3100 \
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:55432/e2etest?schema=public" \
 *   npx tsx scratch-scripts/e2e-verify.ts
 */
import { PrismaClient } from '@prisma/client';

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

/** Meldet an und liefert das Sitzungs-Cookie zurück. */
async function anmelden(email: string, password: string): Promise<string> {
  const r = await fetch(`${APP}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`Anmeldung fehlgeschlagen: ${email} (${r.status})`);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

const j = (cookie: string) => ({ 'Content-Type': 'application/json', Cookie: cookie });

(async () => {
  const schulamt = await anmelden('admin@schulamt-musterstadt.de', 'musterstadt123');
  const schule = await anmelden('marktplatz@musterstadt.de', 'schule123');
  const lehrkraft = await anmelden('lehrkraft@musterstadt.de', 'lehrkraft123');

  const schoolRow = await prisma.school.findFirstOrThrow({ where: { name: 'Grundschule am Marktplatz' } });
  const teacherRow = await prisma.teacher.findFirstOrThrow({ where: { name: 'Lukas Sonnenschein' } });

  const tag = new Date(); tag.setDate(tag.getDate() + 14); tag.setHours(12, 0, 0, 0);
  const datum = tag.toISOString();

  console.log('\n=== 1. Schule meldet Bedarf ===');
  const anfrage = await fetch(`${APP}/api/requests`, {
    method: 'POST', headers: j(schule),
    body: JSON.stringify({
      schoolId: schoolRow.id, date: datum, startHour: 1, hours: 4, weeklyHours: 4,
      schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Frau Testfall',
      qualifications: 'Grundschule', comments: 'Automatischer Funktionstest',
    }),
  });
  const req = await anfrage.json();
  pruefe('Bedarf wird angelegt (HTTP 201)', anfrage.status === 201, `Status ${anfrage.status}`);
  const inDb = await prisma.request.findUnique({ where: { id: req.id } });
  pruefe('Bedarf steht in der Datenbank', !!inDb && inDb.status === 'PENDING');

  console.log('\n=== 2. Schulamt lässt Kandidaten ermitteln ===');
  const m = await fetch(`${APP}/api/match/${req.id}`, { headers: j(schulamt) });
  const { candidates } = await m.json();
  pruefe('Kandidaten werden geliefert', Array.isArray(candidates) && candidates.length > 0, `${candidates?.length ?? 0} Treffer`);
  const kandidat = candidates?.find((c: { id: string }) => c.id === teacherRow.id);
  pruefe('Erwartete Lehrkraft ist dabei', !!kandidat);
  pruefe('Bewertung und Entfernung sind gesetzt',
    !!kandidat && typeof kandidat.matchScore === 'number' && typeof kandidat.distanceToSchool === 'number');

  console.log('\n=== 3. Schulamt bucht die Lehrkraft ===');
  const bu = await fetch(`${APP}/api/assign`, {
    method: 'POST', headers: j(schulamt),
    body: JSON.stringify({ requestId: req.id, teacherId: teacherRow.id, assignments: [{ date: datum, hours: 4 }] }),
  });
  pruefe('Buchung wird angenommen (HTTP 201)', bu.status === 201, `Status ${bu.status}`);

  const gebucht = await prisma.assignment.findFirst({ where: { requestId: req.id, teacherId: teacherRow.id } });
  pruefe('>>> Die Lehrkraft ist wirklich gebucht (Datensatz existiert)', !!gebucht);
  pruefe('Gebuchte Stunden stimmen', gebucht?.hours === 4, `${gebucht?.hours} statt 4`);
  pruefe('Buchung startet als "nicht bestätigt"', gebucht?.status === 'PENDING', gebucht?.status);
  const nachBuchung = await prisma.request.findUnique({ where: { id: req.id } });
  pruefe('Bedarf gilt als besetzt', nachBuchung?.status === 'FILLED', nachBuchung?.status);

  console.log('\n=== 4. Doppelbuchung am selben Tag ===');
  const dop = await fetch(`${APP}/api/assign`, {
    method: 'POST', headers: j(schulamt),
    body: JSON.stringify({ requestId: req.id, teacherId: teacherRow.id, assignments: [{ date: datum, hours: 2 }] }),
  });
  pruefe('Doppelbuchung wird abgewiesen (HTTP 409)', dop.status === 409, `Status ${dop.status}`);
  const anzahl = await prisma.assignment.count({ where: { requestId: req.id } });
  pruefe('Es entstand keine zweite Buchung', anzahl === 1, `${anzahl} Buchungen`);

  console.log('\n=== 5. Lehrkraft bestätigt ===');
  const best = await fetch(`${APP}/api/assignments/${gebucht!.id}/status`, {
    method: 'PATCH', headers: j(lehrkraft), body: JSON.stringify({ status: 'ACCEPTED' }),
  });
  pruefe('Bestätigung wird angenommen', best.ok, `Status ${best.status}`);
  const nachBest = await prisma.assignment.findUnique({ where: { id: gebucht!.id } });
  pruefe('Buchung ist bestätigt', nachBest?.status === 'ACCEPTED', nachBest?.status);

  const ablehnen = await fetch(`${APP}/api/assignments/${gebucht!.id}/status`, {
    method: 'PATCH', headers: j(lehrkraft), body: JSON.stringify({ status: 'REJECTED' }),
  });
  pruefe('Ablehnen ist nicht mehr möglich (HTTP 400)', ablehnen.status === 400, `Status ${ablehnen.status}`);

  console.log('\n=== 6. Ausfallmeldung gibt den Bedarf frei ===');
  const aus = await fetch(`${APP}/api/teachers/absence`, {
    method: 'POST', headers: j(lehrkraft),
    body: JSON.stringify({ date: datum.split('T')[0], reason: 'Funktionstest, keine echte Meldung' }),
  });
  pruefe('Ausfallmeldung wird angenommen', aus.ok, `Status ${aus.status}`);
  const absence = await prisma.absence.findFirst({ where: { teacherId: teacherRow.id } });
  pruefe('Abwesenheit ist gespeichert', !!absence && absence.reason !== null);
  const nachAusfall = await prisma.assignment.findUnique({ where: { id: gebucht!.id } });
  pruefe('Buchung wurde storniert', nachAusfall?.status === 'REJECTED', nachAusfall?.status);
  const reqNachAusfall = await prisma.request.findUnique({ where: { id: req.id } });
  pruefe('Bedarf ist wieder offen', reqNachAusfall?.status === 'PENDING', reqNachAusfall?.status);
  const teacherNachAusfall = await prisma.teacher.findUnique({ where: { id: teacherRow.id } });
  pruefe('Lehrkraft bleibt grundsätzlich aktiv', teacherNachAusfall?.status === 'ACTIVE', teacherNachAusfall?.status);

  console.log('\n=== 7. Fremdzugriff ===');
  const fremd = await fetch(`${APP}/api/requests/${req.id}`, { method: 'DELETE', headers: j(lehrkraft) });
  pruefe('Lehrkraft darf fremde Anfragen nicht löschen', fremd.status === 401 || fremd.status === 403, `Status ${fremd.status}`);
  const ohne = await fetch(`${APP}/api/teachers`);
  pruefe('Ohne Anmeldung kein Zugriff auf Lehrkräfte', ohne.status === 401, `Status ${ohne.status}`);

  console.log('\n=== 8. Längere Abwesenheit (nur Zeitraum, kein Grund) ===');
  // Eigener Bedarf an einem anderen Tag, damit die Prüfungen oben unberührt bleiben.
  const spaeterTag = new Date(); spaeterTag.setDate(spaeterTag.getDate() + 40); spaeterTag.setHours(12, 0, 0, 0);
  const spaetesDatum = spaeterTag.toISOString();

  const anfrage2 = await fetch(`${APP}/api/requests`, {
    method: 'POST', headers: j(schule),
    body: JSON.stringify({
      schoolId: schoolRow.id, date: spaetesDatum, startHour: 1, hours: 4, weeklyHours: 4,
      schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Frau Zweitfall',
      qualifications: 'Grundschule', comments: 'Prüfung längere Abwesenheit',
    }),
  });
  const req2 = await anfrage2.json();

  // Vorher ist die Lehrkraft ein regulärer Kandidat …
  const vorher = await (await fetch(`${APP}/api/match/${req2.id}`, { headers: j(schulamt) })).json();
  pruefe('Vor der Meldung ist die Lehrkraft Kandidatin',
    vorher.candidates?.some((c: { id: string }) => c.id === teacherRow.id));

  // Die Lehrkraft meldet selbst einen Zeitraum, der diesen Tag umfasst.
  const von = new Date(spaeterTag); von.setDate(von.getDate() - 5);
  const bis = new Date(spaeterTag); bis.setDate(bis.getDate() + 30);
  const meldung = await fetch(`${APP}/api/teachers/leave`, {
    method: 'POST', headers: j(lehrkraft),
    body: JSON.stringify({
      startDate: von.toISOString().split('T')[0],
      endDate: bis.toISOString().split('T')[0],
      // Ein mitgeschickter Grund darf NICHT gespeichert werden (Art. 9 DSGVO).
      reason: 'darf nicht gespeichert werden',
      note: 'darf nicht gespeichert werden',
    }),
  });
  pruefe('Lehrkraft kann selbst eine längere Abwesenheit melden (HTTP 201)', meldung.status === 201, `Status ${meldung.status}`);
  const gemeldet = await meldung.json();
  const leaveId = gemeldet?.leave?.id;
  const leaveInDb = leaveId ? await prisma.leavePeriod.findUnique({ where: { id: leaveId } }) : null;
  pruefe('Zeitraum steht in der Datenbank', !!leaveInDb && leaveInDb.teacherId === teacherRow.id);
  pruefe('Der Zeitraum ist als Selbstmeldung gekennzeichnet', leaveInDb?.reportedBy === 'TEACHER', leaveInDb?.reportedBy);
  pruefe('>>> Kein Grund wird gespeichert (Art. 9 DSGVO)',
    !!leaveInDb && !JSON.stringify(leaveInDb).includes('darf nicht gespeichert werden'),
    JSON.stringify(leaveInDb));

  // … danach nicht mehr.
  const nachher = await (await fetch(`${APP}/api/match/${req2.id}`, { headers: j(schulamt) })).json();
  pruefe('>>> Im Zeitraum wird die Lehrkraft nicht mehr vorgeschlagen',
    !nachher.candidates?.some((c: { id: string }) => c.id === teacherRow.id));

  // Auch die manuelle Zuweisung am Vorschlag vorbei muss abgewiesen werden.
  const trotzdem = await fetch(`${APP}/api/assign`, {
    method: 'POST', headers: j(schulamt),
    body: JSON.stringify({ requestId: req2.id, teacherId: teacherRow.id, assignments: [{ date: spaetesDatum, hours: 4 }] }),
  });
  pruefe('Manuelle Zuweisung im Zeitraum wird abgewiesen (HTTP 409)', trotzdem.status === 409, `Status ${trotzdem.status}`);
  const trotzdemAnzahl = await prisma.assignment.count({ where: { requestId: req2.id } });
  pruefe('Es entstand keine Buchung', trotzdemAnzahl === 0, `${trotzdemAnzahl} Buchungen`);

  // Überschneidende Zeiträume sind nicht zulässig.
  const doppelt = await fetch(`${APP}/api/teachers/leave`, {
    method: 'POST', headers: j(lehrkraft),
    body: JSON.stringify({ startDate: spaeterTag.toISOString().split('T')[0], endDate: bis.toISOString().split('T')[0] }),
  });
  pruefe('Überschneidender Zeitraum wird abgewiesen (HTTP 409)', doppelt.status === 409, `Status ${doppelt.status}`);

  const verdreht = await fetch(`${APP}/api/teachers/leave`, {
    method: 'POST', headers: j(lehrkraft),
    body: JSON.stringify({ startDate: '2027-05-01', endDate: '2027-04-01' }),
  });
  pruefe('Ende vor Beginn wird abgewiesen (HTTP 400)', verdreht.status === 400, `Status ${verdreht.status}`);

  console.log('\n=== 9. Zuweisung im Zeitraum wird storniert ===');
  // Ein bereits gebuchter Einsatz muss beim Eintragen eines Zeitraums zurückgegeben werden.
  const dritterTag = new Date(); dritterTag.setDate(dritterTag.getDate() + 100); dritterTag.setHours(12, 0, 0, 0);
  const req3 = await prisma.request.create({
    data: {
      schoolId: schoolRow.id, date: dritterTag, hours: 4, weeklyHours: 4, startHour: 1,
      substitutedTeacher: 'Frau Drittfall', qualifications: 'Grundschule',
      comments: 'Prüfung Stornierung', status: 'FILLED', schoolType: 'GRUNDSCHULE',
    },
  });
  const buchung3 = await prisma.assignment.create({
    data: { requestId: req3.id, teacherId: teacherRow.id, date: dritterTag, hours: 4, status: 'ACCEPTED' },
  });

  const schulamtMeldung = await fetch(`${APP}/api/teachers/leave`, {
    method: 'POST', headers: j(schulamt),
    body: JSON.stringify({
      teacherId: teacherRow.id,
      startDate: dritterTag.toISOString().split('T')[0],
      endDate: null,
    }),
  });
  pruefe('Schulamt kann einen offenen Zeitraum eintragen (HTTP 201)', schulamtMeldung.status === 201, `Status ${schulamtMeldung.status}`);
  const schulamtErgebnis = await schulamtMeldung.json();
  pruefe('Der betroffene Einsatz wird gemeldet', schulamtErgebnis.cancelledAssignments === 1, `${schulamtErgebnis.cancelledAssignments}`);

  const nachStorno = await prisma.assignment.findUnique({ where: { id: buchung3.id } });
  pruefe('>>> Der gebuchte Einsatz wurde storniert', nachStorno?.status === 'REJECTED', nachStorno?.status);
  const req3NachStorno = await prisma.request.findUnique({ where: { id: req3.id } });
  pruefe('Die Anforderung ist wieder offen', req3NachStorno?.status === 'PENDING', req3NachStorno?.status);
  const teacherNachStorno = await prisma.teacher.findUnique({ where: { id: teacherRow.id } });
  pruefe('Die Lehrkraft bleibt samt Historie erhalten', !!teacherNachStorno && teacherNachStorno.status === 'ACTIVE');

  console.log('\n=== 10. Berechtigungen bei Abwesenheitszeiträumen ===');
  const fremdeMeldung = await fetch(`${APP}/api/teachers/leave`, {
    method: 'POST', headers: j(schule),
    body: JSON.stringify({ teacherId: teacherRow.id, startDate: '2028-01-01', endDate: '2028-02-01' }),
  });
  pruefe('Eine Schule darf keine Abwesenheit eintragen', fremdeMeldung.status === 401 || fremdeMeldung.status === 403, `Status ${fremdeMeldung.status}`);

  const ohneAnmeldung = await fetch(`${APP}/api/teachers/leave`);
  pruefe('Ohne Anmeldung kein Zugriff auf Abwesenheiten', ohneAnmeldung.status === 401, `Status ${ohneAnmeldung.status}`);

  const fehler = checks.filter(c => !c[1]).length;
  console.log(`\n${'='.repeat(52)}`);
  console.log(fehler === 0
    ? `ALLE ${checks.length} PRÜFUNGEN BESTANDEN`
    : `${fehler} von ${checks.length} PRÜFUNGEN FEHLGESCHLAGEN`);
  console.log('='.repeat(52) + '\n');
  process.exit(fehler === 0 ? 0 : 1);
})().catch(e => { console.error('\nAbbruch:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
