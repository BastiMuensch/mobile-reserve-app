/**
 * Verifikation der DSGVO-Bereinigung gegen eine echte Datenbank.
 *
 * Belegt:
 *  1. dass die ALTE Löschreihenfolge am Fremdschlüssel scheitert (Regressionsschutz),
 *  2. dass die NEUE Reihenfolge dasselbe Szenario sauber verarbeitet,
 *  3. dass die Fristen (30/400 Tage) genau die erwarteten Felder treffen,
 *  4. dass ein zweiter Lauf nichts mehr verändert (Idempotenz - darauf verlässt sich
 *     der Scheduler in src/lib/cleanupScheduler.ts, der bewusst ohne Lock auskommt).
 *
 * ACHTUNG: Das Skript leert sämtliche Tabellen. Es läuft deshalb ausschließlich gegen
 * eine Datenbank, deren Name "test" enthält (siehe Schutz unten).
 *
 * Aufruf (Beispiel mit einer wegwerfbaren lokalen Instanz):
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:55432/gdpr_test?schema=public" \
 *     npx prisma migrate deploy
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:55432/gdpr_test?schema=public" \
 *     npx tsx scratch-scripts/gdpr-verify.ts
 */
import { PrismaClient } from '@prisma/client';
import { runGdprCleanup } from '../src/lib/dataRetention';

// Sicherung gegen einen versehentlichen Lauf auf echten Daten: Dieses Skript löscht
// alles. Ohne "test" im Datenbanknamen bricht es sofort ab.
const dbUrl = process.env.DATABASE_URL ?? '';
const dbName = dbUrl.split('/').pop()?.split('?')[0] ?? '';
if (!dbName.toLowerCase().includes('test')) {
  console.error(
    `\nABBRUCH: Dieses Skript leert alle Tabellen und darf nur gegen eine Testdatenbank laufen.\n` +
    `Aktuelle Zieldatenbank: "${dbName || '(keine DATABASE_URL gesetzt)'}"\n` +
    `Erwartet wird ein Name, der "test" enthält.\n`
  );
  process.exit(1);
}

const prisma = new PrismaClient();

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

async function seed() {
  await prisma.pushSubscription.deleteMany();
  await prisma.leavePeriod.deleteMany();
  await prisma.absence.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.request.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.school.deleteMany();
  await prisma.user.deleteMany();
  await prisma.systemSetting.deleteMany();

  const schulamt = await prisma.user.create({
    data: { email: 'schulamt@test.local', password: 'x', role: 'SCHULAMT' },
  });
  const school = await prisma.school.create({
    data: {
      name: 'Testschule', address: 'Teststr. 1', latitude: 48, longitude: 10,
      type: 'GRUNDSCHULE', schulamtId: schulamt.id,
    },
  });
  const teacherUser = await prisma.user.create({
    data: { email: 'lehrkraft@test.local', password: 'x', role: 'TEACHER' },
  });
  const teacher = await prisma.teacher.create({
    data: {
      name: 'Test Lehrkraft', stammschuleId: school.id, maxWeeklyHours: 20,
      qualifications: 'Alles', status: 'ACTIVE', homeLat: 48, homeLng: 10,
      preferredType: 'BOTH', userId: teacherUser.id,
    },
  });

  // DER KRITISCHE FALL: mehrwöchige Vertretung, die die 400-Tage-Grenze überspannt.
  // Der Request ist alt genug zum Löschen, eines seiner Assignments aber noch nicht.
  const spanning = await prisma.request.create({
    data: {
      schoolId: school.id, date: daysAgo(410), endDate: daysAgo(395),
      hours: 2, weeklyHours: 10, substitutedTeacher: 'Frau Musterfrau',
      qualifications: 'Alles', comments: 'Vertretung für Frau Musterfrau, Schlüssel bei Herrn Beispiel',
      status: 'FILLED',
    },
  });
  await prisma.assignment.create({
    data: { requestId: spanning.id, teacherId: teacher.id, date: daysAgo(405), hours: 2 },
  });
  await prisma.assignment.create({
    // jünger als 400 Tage -> die alte Logik lässt es stehen und stolpert danach über den FK
    data: { requestId: spanning.id, teacherId: teacher.id, date: daysAgo(396), hours: 2 },
  });

  // Frischer Fall (40 Tage): muss anonymisiert, aber NICHT gelöscht werden.
  await prisma.request.create({
    data: {
      schoolId: school.id, date: daysAgo(40), hours: 2, weeklyHours: 2,
      substitutedTeacher: 'Herr Beispiel', qualifications: 'Alles',
      comments: 'Parken hinter der Turnhalle, Vertretung für Herrn Beispiel',
      status: 'FILLED',
    },
  });

  // Ganz frisch (5 Tage): darf gar nicht angefasst werden.
  await prisma.request.create({
    data: {
      schoolId: school.id, date: daysAgo(5), hours: 2, weeklyHours: 2,
      substitutedTeacher: 'Frau Aktuell', qualifications: 'Alles',
      comments: 'Bitte im Sekretariat melden', status: 'PENDING',
    },
  });

  await prisma.absence.create({
    data: { teacherId: teacher.id, date: daysAgo(40), type: 'UNAVAILABLE', reason: 'Grippe mit Fieber' },
  });
  await prisma.absence.create({
    data: { teacherId: teacher.id, date: daysAgo(410), type: 'UNAVAILABLE', reason: 'Alter Eintrag' },
  });
  await prisma.absence.create({
    data: { teacherId: teacher.id, date: daysAgo(5), type: 'UNAVAILABLE', reason: 'Aktueller Grund' },
  });

  // Längere Abwesenheiten: die Löschfrist läuft ab dem ENDE des Zeitraums. Gespeichert
  // wird nur der Zeitraum, deshalb gibt es hier keine Anonymisierungsstufe.
  await prisma.leavePeriod.create({
    data: { teacherId: teacher.id, startDate: daysAgo(500), endDate: daysAgo(410), reportedBy: 'SCHULAMT' },
  });
  await prisma.leavePeriod.create({
    data: { teacherId: teacher.id, startDate: daysAgo(120), endDate: daysAgo(40), reportedBy: 'TEACHER' },
  });
  await prisma.leavePeriod.create({
    // offener, laufender Zeitraum: darf niemals angefasst werden
    data: { teacherId: teacher.id, startDate: daysAgo(10), endDate: null, reportedBy: 'SCHULAMT' },
  });

  await prisma.pushSubscription.create({
    data: { userId: teacherUser.id, endpoint: 'https://push.example/alt', p256dh: 'a', auth: 'b', createdAt: daysAgo(410) },
  });
  await prisma.pushSubscription.create({
    data: { userId: teacherUser.id, endpoint: 'https://push.example/neu', p256dh: 'a', auth: 'b', createdAt: daysAgo(10) },
  });
}

/** Exakt die alte Implementierung, um den Fehler reproduzierbar zu zeigen. */
async function runOldCleanup() {
  const now = new Date();
  const fourHundredDaysAgo = new Date();
  fourHundredDaysAgo.setDate(now.getDate() - 400);

  await prisma.assignment.deleteMany({ where: { date: { lt: fourHundredDaysAgo } } });
  await prisma.request.deleteMany({ where: { date: { lt: fourHundredDaysAgo } } });
}

async function main() {
  console.log('\n=== 1. ALTE Logik gegen das Szenario ===');
  await seed();
  try {
    await runOldCleanup();
    console.log('   UNERWARTET: alte Logik lief ohne Fehler durch');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const line = msg.split('\n').find(l => l.includes('constraint') || l.includes('Foreign key')) ?? msg.slice(0, 160);
    console.log('   ERWARTET FEHLGESCHLAGEN:', line.trim());
  }

  console.log('\n=== 2. NEUE Logik gegen dasselbe Szenario ===');
  await seed();
  const result = await runGdprCleanup();
  console.log('   Durchgelaufen. Statistik:', JSON.stringify(result.stats));

  console.log('\n=== 3. Ergebnis prüfen ===');
  const checks: [string, boolean][] = [];

  const remainingRequests = await prisma.request.findMany({ orderBy: { date: 'asc' } });
  const remainingAssignments = await prisma.assignment.count();
  const absences = await prisma.absence.findMany({ orderBy: { date: 'asc' } });
  const subs = await prisma.pushSubscription.findMany();
  const marker = await prisma.systemSetting.findUnique({ where: { id: 'lastGdprCleanup' } });

  checks.push(['400-Tage-Request samt Assignments gelöscht', remainingRequests.length === 2 && remainingAssignments === 0]);

  const old40 = remainingRequests.find(r => r.substitutedTeacher.includes('gelöscht'));
  checks.push(['40-Tage-Request: Name anonymisiert', !!old40]);
  checks.push(['40-Tage-Request: comments anonymisiert', old40?.comments === '*** gelöscht (DSGVO) ***']);

  const fresh = remainingRequests.find(r => r.substitutedTeacher === 'Frau Aktuell');
  checks.push(['5-Tage-Request unangetastet', !!fresh && fresh.comments === 'Bitte im Sekretariat melden']);

  checks.push(['400-Tage-Absence gelöscht', absences.length === 2]);
  const abs40 = absences.find(a => a.date < daysAgo(30));
  checks.push(['40-Tage-Absence: reason genullt, Satz bleibt', !!abs40 && abs40.reason === null]);
  const abs5 = absences.find(a => a.reason === 'Aktueller Grund');
  checks.push(['5-Tage-Absence: reason bleibt erhalten', !!abs5]);

  const leaves = await prisma.leavePeriod.findMany({ orderBy: { startDate: 'asc' } });
  checks.push(['400 Tage nach Ende: alter Abwesenheitszeitraum gelöscht', leaves.length === 2]);
  const beendet = leaves.find(l => l.endDate !== null);
  checks.push(['vor 40 Tagen beendeter Zeitraum bleibt vorerst erhalten', !!beendet]);
  const laufend = leaves.find(l => l.endDate === null);
  checks.push(['laufender Zeitraum bleibt erhalten', !!laufend]);
  checks.push(['kein Grund-Feld im Datensatz gespeichert',
    !!laufend && !('type' in laufend) && !('note' in laufend)]);

  checks.push(['altes Push-Abo gelöscht, neues bleibt', subs.length === 1 && subs[0].endpoint.endsWith('/neu')]);
  checks.push(['Nachweis-Zeitstempel geschrieben', !!marker]);

  console.log('\n=== 4. Zweiter Lauf (Idempotenz) ===');
  const second = await runGdprCleanup();
  const nothingLeft = Object.values(second.stats).every(v => v === 0);
  checks.push(['zweiter Lauf ändert nichts mehr', nothingLeft]);
  console.log('   Statistik:', JSON.stringify(second.stats));

  console.log('');
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`   ${ok ? 'OK  ' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  console.log(`\n${failed === 0 ? 'ALLE PRÜFUNGEN BESTANDEN' : `${failed} PRÜFUNG(EN) FEHLGESCHLAGEN`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
