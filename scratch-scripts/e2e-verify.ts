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

  console.log('\n=== 11. Dringlichkeit: kleine Schulen und Häufungen ===');
  {
    const { requestUrgencyScore, urgencyReasons, detectOutbreaks, isSchoolInOutbreak } = await import('../src/lib/urgency');
    const heute = new Date(); heute.setHours(0, 0, 0, 0);
    const inDreiTagen = new Date(heute); inDreiTagen.setDate(heute.getDate() + 3);
    const tagKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const basis = { date: inDreiTagen, endDate: null, priority: 'FORTBILDUNG', status: 'PENDING' };
    const gross = { isSmall: false };
    const klein = { isSmall: true };

    pruefe('>>> Kleine Schule ist dringlicher als große',
      requestUrgencyScore(basis, klein, { today: heute }) > requestUrgencyScore(basis, gross, { today: heute }));
    pruefe('Häufung wiegt schwerer als "kleine Schule"',
      requestUrgencyScore(basis, gross, { isOutbreak: true, today: heute }) > requestUrgencyScore(basis, klein, { today: heute }));
    pruefe('Merkmale werden benannt',
      urgencyReasons(basis, klein, { isOutbreak: true, today: heute }).includes('Kleine Schule') &&
      urgencyReasons(basis, klein, { isOutbreak: true, today: heute }).includes('Häufung'));
    pruefe('Besetzte Anfragen brauchen keine Dringlichkeit',
      requestUrgencyScore({ ...basis, status: 'FILLED' }, klein, { today: heute }) === 0);

    // Drei gleichzeitig offene Anfragen derselben Schule = Häufung, zwei nicht.
    const mach = (schoolId: string) => ({ ...basis, schoolId });
    const zwei = detectOutbreaks([mach('S1'), mach('S1')], { today: heute });
    const drei = detectOutbreaks([mach('S1'), mach('S1'), mach('S1')], { today: heute });
    pruefe('Zwei offene Anfragen sind noch keine Häufung', !zwei.has('S1'));
    pruefe('>>> Drei offene Anfragen am selben Tag ergeben eine Häufung',
      drei.get('S1')?.has(tagKey(inDreiTagen)) === true);
    pruefe('Andere Schulen bleiben unberührt', !drei.has('S2'));

    // Übersteuerung in beide Richtungen – und beide laufen ab.
    const inZehnTagen = new Date(heute); inZehnTagen.setDate(heute.getDate() + 10);
    const vorZehnTagen = new Date(heute); vorZehnTagen.setDate(heute.getDate() - 10);
    pruefe('Schulamt kann eine Häufung erzwingen',
      isSchoolInOutbreak({ outbreakUntil: inZehnTagen }, new Map(), mach('S1'), { today: heute }));
    pruefe('Schulamt kann eine erkannte Häufung abwählen',
      !isSchoolInOutbreak({ outbreakDismissedUntil: inZehnTagen }, drei, mach('S1'), { today: heute }));
    pruefe('>>> Eine abgelaufene Abwahl schaltet die Automatik nicht dauerhaft stumm',
      isSchoolInOutbreak({ outbreakDismissedUntil: vorZehnTagen }, drei, mach('S1'), { today: heute }));
  }

  console.log('\n=== 12. Absage mangels Reserve (rücknehmbar) ===');
  const absageTag = new Date(); absageTag.setDate(absageTag.getDate() + 55); absageTag.setHours(12, 0, 0, 0);
  const absageReq = await prisma.request.create({
    data: {
      schoolId: schoolRow.id, date: absageTag, hours: 4, weeklyHours: 4, startHour: 1,
      substitutedTeacher: 'Frau Absage', qualifications: 'Grundschule',
      comments: 'Prüfung Absage', status: 'PENDING', schoolType: 'GRUNDSCHULE',
    },
  });

  const fremdeAbsage = await fetch(`${APP}/api/requests/${absageReq.id}/unfilled`, {
    method: 'PATCH', headers: j(schule), body: JSON.stringify({ reason: 'unerlaubt' }),
  });
  pruefe('Eine Schule darf sich nicht selbst absagen', fremdeAbsage.status === 401 || fremdeAbsage.status === 403, `Status ${fremdeAbsage.status}`);

  const absage = await fetch(`${APP}/api/requests/${absageReq.id}/unfilled`, {
    method: 'PATCH', headers: j(schulamt), body: JSON.stringify({ reason: 'Alle Reserven im Einsatz' }),
  });
  pruefe('Schulamt kann absagen', absage.ok, `Status ${absage.status}`);
  const nachAbsage = await prisma.request.findUnique({ where: { id: absageReq.id } });
  pruefe('>>> Status steht auf UNFILLED', nachAbsage?.status === 'UNFILLED', nachAbsage?.status);
  pruefe('Begründung und Zeitpunkt sind gespeichert',
    nachAbsage?.unfilledReason === 'Alle Reserven im Einsatz' && !!nachAbsage?.unfilledAt);

  const nochmal = await fetch(`${APP}/api/requests/${absageReq.id}/unfilled`, {
    method: 'PATCH', headers: j(schulamt), body: JSON.stringify({}),
  });
  pruefe('Doppelte Absage wird abgewiesen (HTTP 409)', nochmal.status === 409, `Status ${nochmal.status}`);

  const zurueck = await fetch(`${APP}/api/requests/${absageReq.id}/unfilled`, { method: 'DELETE', headers: j(schulamt) });
  pruefe('Absage lässt sich zurücknehmen', zurueck.ok, `Status ${zurueck.status}`);
  const nachRuecknahme = await prisma.request.findUnique({ where: { id: absageReq.id } });
  pruefe('>>> Anfrage ist wieder offen', nachRuecknahme?.status === 'PENDING', nachRuecknahme?.status);
  pruefe('Begründung wurde geleert',
    nachRuecknahme?.unfilledReason === null && nachRuecknahme?.unfilledAt === null);

  const zurueckOhneAbsage = await fetch(`${APP}/api/requests/${absageReq.id}/unfilled`, { method: 'DELETE', headers: j(schulamt) });
  pruefe('Rücknahme ohne Absage wird abgewiesen (HTTP 409)', zurueckOhneAbsage.status === 409, `Status ${zurueckOhneAbsage.status}`);

  console.log('\n=== 13. Idealbesetzung: Vorschlag ===');
  // Eigene Schulen und ein eigener Tag, damit dieser Abschnitt nicht mit den Daten der
  // Abschnitte 1–12 kollidiert (dort liegen Abwesenheiten und Buchungen für Lukas).
  const schulamtUser = await prisma.user.findFirstOrThrow({ where: { email: 'admin@schulamt-musterstadt.de' } });
  const nord = await prisma.school.create({
    data: { name: 'Testschule Nord', address: 'Nordstr. 1', latitude: 48.0, longitude: 10.2, type: 'GRUNDSCHULE', schulamtId: schulamtUser.id },
  });
  const sued = await prisma.school.create({
    data: { name: 'Testschule Süd', address: 'Südstr. 1', latitude: 48.01, longitude: 10.21, type: 'GRUNDSCHULE', schulamtId: schulamtUser.id, isSmall: true },
  });

  // Ein Montag weit in der Zukunft, außerhalb aller vorher angelegten Abwesenheiten.
  const montag = new Date(); montag.setDate(montag.getDate() + 80); montag.setHours(12, 0, 0, 0);
  while (montag.getDay() !== 1) montag.setDate(montag.getDate() + 1);
  const tagSchluessel = `${montag.getFullYear()}-${String(montag.getMonth() + 1).padStart(2, '0')}-${String(montag.getDate()).padStart(2, '0')}`;

  const machAnfrage = (schoolId: string, datum: Date, extra: Record<string, unknown> = {}) => prisma.request.create({
    data: {
      schoolId, date: datum, hours: 4, weeklyHours: 4, startHour: 1,
      substitutedTeacher: 'Frau Idealtest', qualifications: 'Grundschule',
      comments: 'Prüfung Idealbesetzung', status: 'PENDING', schoolType: 'GRUNDSCHULE', ...extra,
    },
  });

  // Sechs Anforderungen am selben Tag, drei je Schule – deutlich mehr als verfügbare
  // Grundschul-Lehrkräfte, damit die faire Verteilung überhaupt greifen muss.
  for (let i = 0; i < 3; i++) { await machAnfrage(nord.id, montag); await machAnfrage(sued.id, montag); }

  // Eine abgesagte Anforderung darf im Vorschlag nicht auftauchen.
  const abgesagt = await machAnfrage(nord.id, montag, { status: 'UNFILLED', unfilledReason: 'Test', unfilledAt: new Date() });

  const bisTag13 = new Date(montag); bisTag13.setDate(bisTag13.getDate() + 10);
  const bisSchluessel = `${bisTag13.getFullYear()}-${String(bisTag13.getMonth() + 1).padStart(2, '0')}-${String(bisTag13.getDate()).padStart(2, '0')}`;

  type Segment = { teacherId: string; teacherName: string; entries: { date: string; hours: number }[]; reasons: string[] };
  type SchulVorschlag = {
    schoolId: string; schoolName: string;
    coverage: { filledRequests: number; totalRequests: number };
    proposals: { requestId: string; segments: Segment[]; urgency: { reasons: string[] } }[];
    unfillable: { requestId: string; reason: string }[];
  };

  const holeVorschlag = async (): Promise<SchulVorschlag[]> => {
    const r = await fetch(`${APP}/api/batch-assign/preview`, {
      method: 'POST', headers: j(schulamt), body: JSON.stringify({ until: bisSchluessel }),
    });
    if (!r.ok) return [];
    return (await r.json()).schools as SchulVorschlag[];
  };

  const vorschlag = await holeVorschlag();
  pruefe('Vorschlag wird geliefert', vorschlag.length > 0, `${vorschlag.length} Schulen`);

  const vNord = vorschlag.find(s => s.schoolId === nord.id);
  const vSued = vorschlag.find(s => s.schoolId === sued.id);
  pruefe('Beide Testschulen sind enthalten', !!vNord && !!vSued);

  // Keine Lehrkraft darf über ALLE Vorschläge hinweg zweimal am selben Tag stehen.
  const belegung = new Set<string>();
  let doppeltBelegt = false;
  for (const schule of vorschlag) {
    for (const p of schule.proposals) {
      for (const seg of p.segments) {
        for (const e of seg.entries) {
          const key = `${seg.teacherId}|${e.date}`;
          if (belegung.has(key)) doppeltBelegt = true;
          belegung.add(key);
        }
      }
    }
  }
  pruefe('>>> Keine Lehrkraft doppelt am selben Tag', !doppeltBelegt);

  pruefe('Begründungen sind vorhanden',
    (vNord?.proposals[0]?.segments[0]?.reasons.length ?? 0) > 0);
  pruefe('Segmenttage liegen am angeforderten Tag',
    vorschlag.filter(s => s.schoolId === nord.id || s.schoolId === sued.id)
      .every(s => s.proposals.every(p => p.segments.every(seg => seg.entries.every(e => e.date === tagSchluessel)))));

  pruefe('>>> Abgesagte Anforderung taucht im Vorschlag nicht auf',
    !vorschlag.some(s => s.proposals.some(p => p.requestId === abgesagt.id) || s.unfillable.some(u => u.requestId === abgesagt.id)));

  const nordBesetzt = vNord?.proposals.length ?? 0;
  const suedBesetzt = vSued?.proposals.length ?? 0;
  pruefe('>>> Keine Schule geht leer aus', nordBesetzt > 0 && suedBesetzt > 0, `Nord ${nordBesetzt}, Süd ${suedBesetzt}`);
  pruefe('>>> Der Mangel ist gleichmäßig verteilt (Unterschied höchstens 1)',
    Math.abs(nordBesetzt - suedBesetzt) <= 1, `Nord ${nordBesetzt}, Süd ${suedBesetzt}`);
  pruefe('Die kleine Schule ist als solche gekennzeichnet',
    vSued?.proposals.every(p => p.urgency.reasons.includes('Kleine Schule')) === true);
  pruefe('Unbesetzbare Anforderungen werden begründet',
    (vNord?.unfillable ?? []).every(u => u.reason.length > 0));

  console.log('\n=== 14. Idealbesetzung: Kontinuität ===');
  const langAnfang = new Date(montag); langAnfang.setDate(langAnfang.getDate() + 7);
  const langEnde = new Date(langAnfang); langEnde.setDate(langEnde.getDate() + 4); // Mo–Fr
  const langReq = await machAnfrage(nord.id, langAnfang, { endDate: langEnde, weeklyHours: 20 });

  const bis2 = new Date(langEnde); bis2.setDate(bis2.getDate() + 2);
  const bis2Schluessel = `${bis2.getFullYear()}-${String(bis2.getMonth() + 1).padStart(2, '0')}-${String(bis2.getDate()).padStart(2, '0')}`;
  const r14 = await fetch(`${APP}/api/batch-assign/preview`, {
    method: 'POST', headers: j(schulamt), body: JSON.stringify({ until: bis2Schluessel }),
  });
  const v14 = (await r14.json()).schools as SchulVorschlag[];
  const langVorschlag = v14.flatMap(s => s.proposals).find(p => p.requestId === langReq.id);
  pruefe('Mehrtägige Anforderung wird besetzt', !!langVorschlag);
  pruefe('>>> Eine Lehrkraft deckt die ganze Woche ab, nicht fünf verschiedene',
    langVorschlag?.segments.length === 1, `${langVorschlag?.segments.length} Segmente`);
  pruefe('Das Segment ist als durchgehend gekennzeichnet',
    langVorschlag?.segments[0]?.reasons.includes('Durchgehend') === true,
    JSON.stringify(langVorschlag?.segments[0]?.reasons));
  const tageDesSegments = langVorschlag?.segments[0]?.entries.map(e => e.date) ?? [];
  pruefe('Alle Werktage der Woche sind abgedeckt', tageDesSegments.length === 5, `${tageDesSegments.length} Tage`);

  console.log('\n=== 15. Idealbesetzung: Freigabe ===');
  const nordItems = (vNord?.proposals ?? []).map(p => ({
    requestId: p.requestId,
    segments: p.segments.map(s => ({ teacherId: s.teacherId, entries: s.entries })),
  }));

  const fremdeFreigabe = await fetch(`${APP}/api/batch-assign/approve`, {
    method: 'POST', headers: j(schule), body: JSON.stringify({ schoolId: nord.id, items: nordItems }),
  });
  pruefe('Eine Schule darf nicht freigeben', fremdeFreigabe.status === 401 || fremdeFreigabe.status === 403, `Status ${fremdeFreigabe.status}`);
  const anonymVorschlag = await fetch(`${APP}/api/batch-assign/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ until: bisSchluessel }),
  });
  pruefe('Ohne Anmeldung kein Vorschlag', anonymVorschlag.status === 401, `Status ${anonymVorschlag.status}`);

  const freigabe = await fetch(`${APP}/api/batch-assign/approve`, {
    method: 'POST', headers: j(schulamt), body: JSON.stringify({ schoolId: nord.id, items: nordItems }),
  });
  pruefe('Freigabe wird angenommen (HTTP 201)', freigabe.status === 201, `Status ${freigabe.status}`);

  let stimmtGenau = true;
  for (const item of nordItems) {
    for (const seg of item.segments) {
      for (const e of seg.entries) {
        const tag = new Date(`${e.date}T00:00:00`);
        const bisTag = new Date(tag); bisTag.setHours(23, 59, 59, 999);
        const treffer = await prisma.assignment.findFirst({
          where: { requestId: item.requestId, teacherId: seg.teacherId, date: { gte: tag, lte: bisTag }, status: { not: 'REJECTED' } },
        });
        if (!treffer || treffer.hours !== e.hours) stimmtGenau = false;
      }
    }
  }
  pruefe('>>> Es wurde genau das angelegt, was vorgeschlagen war', stimmtGenau);

  const suedAnfragen = await prisma.request.findMany({ where: { schoolId: sued.id } });
  const suedZuweisungen = await prisma.assignment.count({ where: { requestId: { in: suedAnfragen.map(r => r.id) } } });
  pruefe('>>> Die zweite Schule blieb unberührt', suedZuweisungen === 0, `${suedZuweisungen} Zuweisungen`);

  console.log('\n=== 16. Idealbesetzung: veralteter Vorschlag ===');
  const vorschlag2 = await holeVorschlag();
  const vSued2 = vorschlag2.find(s => s.schoolId === sued.id);
  const suedItems = (vSued2?.proposals ?? []).map(p => ({
    requestId: p.requestId,
    segments: p.segments.map(s => ({ teacherId: s.teacherId, entries: s.entries })),
  }));
  pruefe('Für die zweite Schule liegt ein Vorschlag vor', suedItems.length > 0);

  // Nach dem Vorschlag meldet sich eine vorgesehene Lehrkraft für den Tag ab.
  const betroffen = suedItems[0].segments[0].teacherId;
  const abwesenheit = await prisma.absence.create({
    data: { teacherId: betroffen, date: new Date(`${tagSchluessel}T00:00:00`), type: 'UNAVAILABLE', reason: 'Prüfung veralteter Vorschlag' },
  });
  await prisma.assignment.create({
    data: { requestId: suedItems[0].requestId, teacherId: betroffen, date: new Date(`${tagSchluessel}T08:00:00`), hours: 1, status: 'ACCEPTED' },
  });

  const veraltet = await fetch(`${APP}/api/batch-assign/approve`, {
    method: 'POST', headers: j(schulamt), body: JSON.stringify({ schoolId: sued.id, items: suedItems }),
  });
  pruefe('>>> Veralteter Vorschlag wird abgewiesen (HTTP 409)', veraltet.status === 409, `Status ${veraltet.status}`);
  const suedNachKonflikt = await prisma.assignment.count({
    where: { requestId: { in: suedAnfragen.map(r => r.id) }, hours: { not: 1 } },
  });
  pruefe('>>> Bei Konflikt wird nichts angelegt', suedNachKonflikt === 0, `${suedNachKonflikt} Zuweisungen`);

  console.log('\n=== 17. Idealbesetzung: Abwahl ===');
  await prisma.absence.delete({ where: { id: abwesenheit.id } });
  await prisma.assignment.deleteMany({ where: { requestId: suedItems[0].requestId } });
  await prisma.request.update({ where: { id: suedItems[0].requestId }, data: { status: 'PENDING' } });

  const vorschlag3 = await holeVorschlag();
  const suedItems3 = (vorschlag3.find(s => s.schoolId === sued.id)?.proposals ?? []).map(p => ({
    requestId: p.requestId,
    segments: p.segments.map(s => ({ teacherId: s.teacherId, entries: s.entries })),
  }));

  if (suedItems3.length > 0) {
    // Nur die erste Anforderung freigeben – die übrigen sind abgewählt.
    const nurEine = await fetch(`${APP}/api/batch-assign/approve`, {
      method: 'POST', headers: j(schulamt), body: JSON.stringify({ schoolId: sued.id, items: [suedItems3[0]] }),
    });
    pruefe('Teil-Freigabe wird angenommen', nurEine.status === 201, `Status ${nurEine.status}`);
    const angelegt = await prisma.assignment.count({ where: { requestId: suedItems3[0].requestId } });
    pruefe('>>> Nur die ausgewählte Anforderung wurde besetzt', angelegt > 0);
    const abgewaehlt = suedItems3.slice(1);
    const abgewaehltAngelegt = abgewaehlt.length === 0 ? 0
      : await prisma.assignment.count({ where: { requestId: { in: abgewaehlt.map(i => i.requestId) } } });
    pruefe('>>> Abgewählte Anforderungen bleiben unbesetzt', abgewaehltAngelegt === 0, `${abgewaehltAngelegt} Zuweisungen`);
  } else {
    pruefe('Teil-Freigabe konnte geprüft werden', false, 'kein Vorschlag für die zweite Schule');
  }

  const fehler = checks.filter(c => !c[1]).length;
  console.log(`\n${'='.repeat(52)}`);
  console.log(fehler === 0
    ? `ALLE ${checks.length} PRÜFUNGEN BESTANDEN`
    : `${fehler} von ${checks.length} PRÜFUNGEN FEHLGESCHLAGEN`);
  console.log('='.repeat(52) + '\n');
  process.exit(fehler === 0 ? 0 : 1);
})().catch(e => { console.error('\nAbbruch:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
