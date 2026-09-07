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
  deletedLeavePeriods: number;
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
 *  - 400 Tage: Assignments, Requests, Absences, beendete Abwesenheitszeiträume und
 *              verwaiste Push-Abos werden endgültig gelöscht.
 *
 * Längere Abwesenheiten (LeavePeriod) brauchen keine Anonymisierungsstufe: Dort wird
 * von vornherein nur der Zeitraum gespeichert, kein Grund und kein Freitext.
 *
 * Alle Schritte laufen in einer einzigen Transaktion, damit bei einem Fehler in
 * einem späteren Schritt keine "halb durchgeführte" Bereinigung (z.B. schon
 * anonymisiert, aber noch nicht gelöscht) stehen bleibt, über die niemand informiert
 * wird.
 */
/**
 * Ermittelt das fachliche Abschlussdatum eines Bedarfs.
 * - offener Bedarf ohne endedAt: noch laufend (null)
 * - vorzeitig beendeter Bedarf: endedAt
 * - regulär befristeter Bedarf: endDate
 * - eintägiger Bedarf: date
 */
export function getRequestCompletionDate(request: {
  date: Date;
  endDate?: Date | null;
  isOpenEnded?: boolean;
  endedAt?: Date | null;
}): Date | null {
  if (request.isOpenEnded && !request.endedAt) {
    return null;
  }
  if (request.endedAt) {
    return request.endedAt;
  }
  if (request.endDate) {
    return request.endDate;
  }
  return request.date;
}

/**
 * Erzeugt den Prisma-Filter für Bedarfe, deren fachliches Abschlussdatum
 * vor dem übergebenen Stichtag liegt. Laufende offene Bedarfe (isOpenEnded && !endedAt)
 * werden dadurch vollständig ausgeschlossen.
 */
export function buildCompletedRequestFilter(cutoffDate: Date) {
  return {
    OR: [
      {
        isOpenEnded: true,
        endedAt: { not: null, lt: cutoffDate },
      },
      {
        isOpenEnded: false,
        endDate: { not: null, lt: cutoffDate },
      },
      {
        isOpenEnded: false,
        endDate: null,
        date: { lt: cutoffDate },
      },
    ],
  };
}

export async function runGdprCleanup(): Promise<GdprCleanupResult> {
  const now = new Date();

  // Stichtage auf lokale Tagesgrenzen normalisieren, damit die Frist nicht je nach
  // Uhrzeit des Cronlaufs (planmäßig 02:00 Uhr, siehe DEPLOYMENT.md) um einen Tag
  // schwankt - siehe toLocalDayStart in matching.ts für dasselbe Muster.
  const thirtyDaysAgo = toLocalDayStart(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const fourHundredDaysAgo = toLocalDayStart(now);
  fourHundredDaysAgo.setDate(fourHundredDaysAgo.getDate() - 400);

  const completed30Filter = buildCompletedRequestFilter(thirtyDaysAgo);
  const completed400Filter = buildCompletedRequestFilter(fourHundredDaysAgo);

  const {
    anonymizedTeacherNames,
    anonymizedComments,
    anonymizedAbsenceReasons,
    deletedAssignments,
    deletedRequests,
    deletedAbsences,
    deletedLeavePeriods,
    deletedPushSubscriptions,
  } = await prisma.$transaction(
    async (tx) => {
      // 30 Tage: Klarnamen in noch bestehenden, bereits abgeschlossenen Requests anonymisieren.
      // Laufende Bedarfe (isOpenEnded ohne endedAt) bleiben vollständig unberührt.
      const anonymizedTeacherNames = await tx.request.updateMany({
        where: {
          AND: [
            completed30Filter,
            { substitutedTeacher: { not: ANONYMIZED_PLACEHOLDER } },
          ],
        },
        data: { substitutedTeacher: ANONYMIZED_PLACEHOLDER },
      });

      // 30 Tage: comments ist zwar in der API Pflichtfeld, im Schema aber optional
      // (ältere Datensätze). "not: null" verhindert, dass wir ein legitim leeres Feld
      // mit dem Platzhalter überschreiben; "notIn" verhindert, dass ein zweiter Lauf
      // bereits anonymisierte Zeilen erneut anfasst.
      const anonymizedComments = await tx.request.updateMany({
        where: {
          AND: [
            completed30Filter,
            { comments: { not: null, notIn: [ANONYMIZED_PLACEHOLDER] } },
          ],
        },
        data: { comments: ANONYMIZED_PLACEHOLDER },
      });

      // 30 Tage: Freitext-Begründung eines ungeplanten Ausfalls nullen (kann
      // Gesundheitsangaben enthalten, Art. 9 DSGVO - siehe Commit b55b54f). Der
      // Absence-Datensatz selbst bleibt bis zur 400-Tage-Frist bestehen.
      const anonymizedAbsenceReasons = await tx.absence.updateMany({
        where: { date: { lt: thirtyDaysAgo }, reason: { not: null } },
        data: { reason: null },
      });

      // 400 Tage, Schritt 1: Assignments der tatsächlich zu löschenden Requests entfernen.
      // Zuweisungen werden nur zusammen mit tatsächlich abgelaufenen/löschbaren Bedarfen
      // entfernt. Laufende Daten bleiben unabhängig von ihrem Startdatum erhalten.
      const deletedAssignments = await tx.assignment.deleteMany({
        where: { request: completed400Filter },
      });

      // 400 Tage, Schritt 2: jetzt sind alle referenzierenden Assignments der betroffenen
      // Requests weg, die Requests selbst können gefahrlos gelöscht werden.
      const deletedRequests = await tx.request.deleteMany({
        where: completed400Filter,
      });

      // 400 Tage: Absence-Datensätze vollständig löschen (reason wurde spätestens nach
      // 30 Tagen bereits genullt, siehe oben).
      const deletedAbsences = await tx.absence.deleteMany({
        where: { date: { lt: fourHundredDaysAgo } },
      });

      // 400 Tage nach ihrem Ende: abgelaufene Abwesenheitszeiträume löschen.
      // Zeiträume ohne Enddatum laufen noch und werden nicht angefasst.
      const deletedLeavePeriods = await tx.leavePeriod.deleteMany({
        where: { endDate: { not: null, lt: fourHundredDaysAgo } },
      });

      // 400 Tage: verwaiste Push-Abos aufräumen.
      const deletedPushSubscriptions = await tx.pushSubscription.deleteMany({
        where: { createdAt: { lt: fourHundredDaysAgo } },
      });

      return {
        anonymizedTeacherNames,
        anonymizedComments,
        anonymizedAbsenceReasons,
        deletedAssignments,
        deletedRequests,
        deletedAbsences,
        deletedLeavePeriods,
        deletedPushSubscriptions,
      };
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    }
  );

  const stats: GdprCleanupStats = {
    anonymizedTeacherNames: anonymizedTeacherNames.count,
    anonymizedComments: anonymizedComments.count,
    anonymizedAbsenceReasons: anonymizedAbsenceReasons.count,
    deletedAssignments: deletedAssignments.count,
    deletedRequests: deletedRequests.count,
    deletedAbsences: deletedAbsences.count,
    deletedLeavePeriods: deletedLeavePeriods.count,
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
