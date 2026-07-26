import { prisma } from '@/lib/prisma';
import { toLocalDayStart } from '@/lib/matching';

// Gleicher Platzhalter wie bisher für substitutedTeacher - wird auch für comments
// verwendet, damit ein zweiter Lauf beide Felder als "bereits anonymisiert" erkennt.
const ANONYMIZED_PLACEHOLDER = '*** gelöscht (DSGVO) ***';

const SETTINGS_KEY_LAST_CLEANUP = 'lastGdprCleanup';

export interface GdprCleanupStats {
  anonymizedTeacherNames: number;
  anonymizedComments: number;
  anonymizedAbsenceReasons: number;
  deletedAssignments: number;
  deletedRequests: number;
  deletedAbsences: number;
  deletedPushSubscriptions: number;
}

export interface GdprCleanupResult {
  ranAt: string;
  stats: GdprCleanupStats;
}

/**
 * Liest den Nachweis über den letzten erfolgreichen Lauf. Gibt `null` zurück, wenn die
 * Bereinigung noch nie durchgelaufen ist oder der gespeicherte Wert unlesbar ist –
 * beides bedeutet für den Aufrufer dasselbe: Es liegt kein gültiger Nachweis vor.
 */
export async function readLastCleanup(): Promise<GdprCleanupResult | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { id: SETTINGS_KEY_LAST_CLEANUP }
  });
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.value) as GdprCleanupResult;
    if (!parsed?.ranAt || Number.isNaN(new Date(parsed.ranAt).getTime())) return null;
    return parsed;
  } catch {
    console.error('[DSGVO-CLEANUP] Gespeicherter Zeitstempel ist unlesbar:', row.value);
    return null;
  }
}

/**
 * Nächtliche DSGVO-Bereinigung. Fristen (siehe DEPLOYMENT.md, Teil 3):
 *  - 30 Tage:  Klarnamen (Request.substitutedTeacher, Request.comments) und die
 *              Freitext-Begründung eines ungeplanten Ausfalls (Absence.reason,
 *              ggf. Gesundheitsangaben nach Art. 9 DSGVO) werden anonymisiert/genullt.
 *  - 400 Tage: Assignments, Requests, Absences und verwaiste Push-Abos werden
 *              endgültig gelöscht.
 *
 * Alle Schritte laufen in einer einzigen Transaktion, damit bei einem Fehler in
 * einem späteren Schritt keine "halb durchgeführte" Bereinigung (z.B. schon
 * anonymisiert, aber noch nicht gelöscht) stehen bleibt, über die niemand informiert
 * wird.
 */
export async function runGdprCleanup(): Promise<GdprCleanupResult> {
  const now = new Date();

  // Stichtage auf lokale Tagesgrenzen normalisieren, damit die Frist nicht je nach
  // Uhrzeit des Cronlaufs (planmäßig 02:00 Uhr, siehe DEPLOYMENT.md) um einen Tag
  // schwankt - siehe toLocalDayStart in matching.ts für dasselbe Muster.
  const thirtyDaysAgo = toLocalDayStart(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const fourHundredDaysAgo = toLocalDayStart(now);
  fourHundredDaysAgo.setDate(fourHundredDaysAgo.getDate() - 400);

  // Hinweis zur Reihenfolge: Assignment.requestId -> Request ist per ON DELETE RESTRICT
  // abgesichert (siehe prisma/migrations/20260607132002_init/migration.sql). Ein
  // Assignment liegt immer innerhalb des Request-Zeitraums, also
  // Assignment.date >= Request.date: Bei einer mehrwöchigen Vertretung, die über die
  // 400-Tage-Grenze reicht, ist der Request bereits alt genug zum Löschen, während
  // einzelne Assignments es (nach ihrem eigenen Datum) noch nicht wären. Deshalb löschen
  // wir zuerst ALLE Assignments der zu löschenden Requests über requestId - unabhängig
  // vom Assignment-Datum - bevor wir die Requests selbst löschen. Vorbild für dieses
  // Muster ist src/app/api/reset/route.ts.
  //
  // Wir verwenden hier bewusst die interaktive $transaction-Form (Callback statt
  // Promise-Array): nur sie erlaubt in dieser Prisma-Version ein eigenes
  // maxWait/timeout, und die zu löschenden Request-IDs müssen ohnehin innerhalb
  // derselben Transaktion ermittelt werden, bevor sie referenziert werden.
  const {
    anonymizedTeacherNames,
    anonymizedComments,
    anonymizedAbsenceReasons,
    deletedAssignmentsByRequest,
    deletedRemainingOldAssignments,
    deletedRequests,
    deletedAbsences,
    deletedPushSubscriptions,
  } = await prisma.$transaction(
    async (tx) => {
      // 30 Tage: Klarnamen in noch bestehenden Requests anonymisieren.
      const anonymizedTeacherNames = await tx.request.updateMany({
        where: {
          date: { lt: thirtyDaysAgo },
          substitutedTeacher: { not: ANONYMIZED_PLACEHOLDER }
        },
        data: { substitutedTeacher: ANONYMIZED_PLACEHOLDER }
      });

      // 30 Tage: comments ist zwar in der API Pflichtfeld, im Schema aber optional
      // (ältere Datensätze). "not: null" verhindert, dass wir ein legitim leeres Feld
      // mit dem Platzhalter überschreiben; "notIn" verhindert, dass ein zweiter Lauf
      // bereits anonymisierte Zeilen erneut anfasst.
      const anonymizedComments = await tx.request.updateMany({
        where: {
          date: { lt: thirtyDaysAgo },
          comments: { not: null, notIn: [ANONYMIZED_PLACEHOLDER] }
        },
        data: { comments: ANONYMIZED_PLACEHOLDER }
      });

      // 30 Tage: Freitext-Begründung eines ungeplanten Ausfalls nullen (kann
      // Gesundheitsangaben enthalten, Art. 9 DSGVO - siehe Commit b55b54f). Der
      // Absence-Datensatz selbst bleibt bis zur 400-Tage-Frist bestehen.
      const anonymizedAbsenceReasons = await tx.absence.updateMany({
        where: { date: { lt: thirtyDaysAgo }, reason: { not: null } },
        data: { reason: null }
      });

      // 400 Tage, Schritt 1: Assignments der zu löschenden Requests entfernen -
      // unabhängig vom Assignment-Datum (siehe Erklärung oben).
      //
      // Gefiltert wird über die Relation statt über eine vorher eingesammelte ID-Liste:
      // Der erste Lauf auf einem Bestandssystem erfasst sämtliche Altdaten auf einmal,
      // und eine `IN (...)`-Liste würde dort gegen das Parameterlimit von Postgres
      // (65535) laufen. Der Relationsfilter erzeugt stattdessen ein einziges Subquery.
      const deletedAssignmentsByRequest = await tx.assignment.deleteMany({
        where: { request: { date: { lt: fourHundredDaysAgo } } }
      });

      // 400 Tage, Schritt 2: defensiv weiterhin alte Assignments löschen, deren Request
      // nicht mitgelöscht wird (nach der Geschäftslogik sollte das nicht vorkommen, da
      // Assignment.date >= Request.date gilt - aber falls doch, verhindert das ein
      // dauerhaft übrig bleibendes altes Assignment).
      const deletedRemainingOldAssignments = await tx.assignment.deleteMany({
        where: {
          date: { lt: fourHundredDaysAgo },
          request: { date: { gte: fourHundredDaysAgo } }
        }
      });

      // 400 Tage, Schritt 3: jetzt sind alle referenzierenden Assignments weg, die
      // Requests können gefahrlos gelöscht werden.
      const deletedRequests = await tx.request.deleteMany({
        where: { date: { lt: fourHundredDaysAgo } }
      });

      // 400 Tage: Absence-Datensätze vollständig löschen (reason wurde spätestens nach
      // 30 Tagen bereits genullt, siehe oben).
      const deletedAbsences = await tx.absence.deleteMany({
        where: { date: { lt: fourHundredDaysAgo } }
      });

      // 400 Tage: verwaiste Push-Abos aufräumen. Push-Abos laufen ohnehin ab und
      // Betroffene können sich jederzeit neu registrieren, ein Verlust ist unkritisch.
      const deletedPushSubscriptions = await tx.pushSubscription.deleteMany({
        where: { createdAt: { lt: fourHundredDaysAgo } }
      });

      return {
        anonymizedTeacherNames,
        anonymizedComments,
        anonymizedAbsenceReasons,
        deletedAssignmentsByRequest,
        deletedRemainingOldAssignments,
        deletedRequests,
        deletedAbsences,
        deletedPushSubscriptions,
      };
    },
    {
      // Großzügigere Werte als der Prisma-Standard (maxWait 2s / timeout 5s): Läuft die
      // Bereinigung nach längerer Downtime oder erstmals auf einem Bestandssystem mit
      // vielen Jahren an Altdaten, kann sie deutlich länger als die Standardwerte
      // brauchen. 30s Ausführungszeit und 10s Wartezeit auf eine freie Verbindung sind
      // für einen nächtlichen Cronjob unproblematisch und verhindern, dass die
      // Transaktion bei etwas höherem Datenvolumen vorzeitig abbricht.
      maxWait: 10_000,
      timeout: 30_000,
    }
  );

  const stats: GdprCleanupStats = {
    anonymizedTeacherNames: anonymizedTeacherNames.count,
    anonymizedComments: anonymizedComments.count,
    anonymizedAbsenceReasons: anonymizedAbsenceReasons.count,
    deletedAssignments: deletedAssignmentsByRequest.count + deletedRemainingOldAssignments.count,
    deletedRequests: deletedRequests.count,
    deletedAbsences: deletedAbsences.count,
    deletedPushSubscriptions: deletedPushSubscriptions.count,
  };

  const ranAt = now.toISOString();

  // Nachweis über den letzten ERFOLGREICHEN Lauf (Art. 5 Abs. 2 DSGVO,
  // Rechenschaftspflicht). Bewusst NACH der Haupttransaktion und separat davon: die
  // Lösch-/Anonymisierungsschritte oben sind zu diesem Zeitpunkt bereits erfolgreich
  // committet. Schlägt dieser Schreibvorgang ausnahmsweise fehl (z.B. DB-Verbindung
  // bricht direkt nach dem Commit ab), wirft er weiter und der Aufrufer meldet einen
  // Fehler - das ist hier gewollt, weil der Zeitstempel selbst Teil des geforderten
  // Nachweises ist und ein stiller Fehlschlag hier den nächsten Lauf so aussehen ließe,
  // als wäre die Bereinigung länger überfällig, als sie ist.
  await prisma.systemSetting.upsert({
    where: { id: SETTINGS_KEY_LAST_CLEANUP },
    update: { value: JSON.stringify({ ranAt, stats }) },
    create: { id: SETTINGS_KEY_LAST_CLEANUP, value: JSON.stringify({ ranAt, stats }) }
  });

  return { ranAt, stats };
}
