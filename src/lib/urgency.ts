/**
 * Dringlichkeit einer Anfrage.
 *
 * Nicht jede offene Anfrage ist gleich dringend: Eine kleine Schule hat kaum eigenes
 * Kollegium, das einen Ausfall auffangen kann, und eine Schule mit einer Magen-Darm-Welle
 * (mehrere gleichzeitige Ausfälle = "Häufung") braucht dringender Hilfe als eine große
 * Schule mit einer einzelnen Lücke. Dieses Modul berechnet daraus einen Punktwert und
 * erkennt Häufungen automatisch aus den offenen Anfragen.
 *
 * Reine Hilfsfunktionen ohne Datenbankzugriff, damit sie sowohl im Server-Code als auch
 * in Client-Komponenten verwendet werden können (siehe leave.ts, matching.ts).
 */

import { toLocalDayStart, toLocalDateKey } from './matching';

// --- Gewichtung ---
// Die konkreten Zahlen sind bewusst grob gestuft (Vielfache von 5/10), nicht das Ergebnis
// einer Formel - es geht um eine plausible Reihenfolge in der UI, nicht um exakte
// Wissenschaft. Ein überfälliger Bedarf (Ende liegt in der Vergangenheit, die Schule
// wartet also schon zu lange) wiegt schwerer als eine bloß anstehende Lücke. Eine
// Häufung wiegt am schwersten, weil dort mehrere Klassen gleichzeitig betroffen sind.
export const URGENCY_SMALL_SCHOOL = 30;
export const URGENCY_OUTBREAK = 50;
export const URGENCY_PRIORITY_1 = 20; // priority === 'UNPLANNED_ABSENCE' (ungeplant, kein Vorlauf)
export const URGENCY_OVERDUE = 40; // Ende der Anfrage liegt vor heute
export const URGENCY_IMMINENT = 15; // beginnt heute oder in den nächsten 2 Tagen, und nicht überfällig

// Ab wie vielen gleichzeitig offenen Anfragen einer Schule an einem Tag von einer
// Häufung gesprochen wird.
export const OUTBREAK_THRESHOLD = 3;

// Maximale Anzahl Tage, die eine einzelne Anfrage bei der Tag-für-Tag-Expansion beisteuern
// darf. Schützt vor hängenden Berechnungen bei einem versehentlich absurden Datumsbereich
// (z.B. ein Tippfehler im Jahr des Enddatums).
const MAX_EXPANSION_DAYS = 200;

// Ein möglichst minimaler struktureller Typ, der sowohl auf Prisma-Request-Zeilen als auch
// auf die Client-seitige RequestData (String-Daten) passt.
export type UrgencyInput = {
  date: Date | string;
  endDate?: Date | string | null;
  priority?: string | null;
  status: string;
};

export type UrgencySchoolInput = {
  isSmall?: boolean | null;
  outbreakUntil?: Date | string | null;
  outbreakDismissedUntil?: Date | string | null;
};

type UrgencyOptions = {
  isOutbreak?: boolean;
  today?: Date;
};

// Status, für die sich keine Priorisierung mehr lohnt - die Anfrage ist erledigt oder
// hinfällig.
const CLOSED_STATUSES = new Set(['FILLED', 'CANCELLED', 'UNFILLED']);
const OPEN_STATUSES = new Set(['PENDING', 'PARTIALLY_FILLED']);

function isOverdue(request: UrgencyInput, today: Date): boolean {
  const end = request.endDate ? toLocalDayStart(request.endDate) : toLocalDayStart(request.date);
  return end < today;
}

function isImminent(request: UrgencyInput, today: Date, overdue: boolean): boolean {
  if (overdue) return false;
  const start = toLocalDayStart(request.date);
  const diffDays = Math.round((start.getTime() - today.getTime()) / 86400000);
  return diffDays >= 0 && diffDays <= 2;
}

/**
 * Eine einzelne Regel: Bedingung, Punktwert und deutsches UI-Label. score() und reasons()
 * werden beide aus derselben Liste abgeleitet, damit sie nie auseinanderlaufen können.
 */
type UrgencyRule = { applies: boolean; weight: number; label: string };

function buildRules(
  request: UrgencyInput,
  school: UrgencySchoolInput,
  options: UrgencyOptions | undefined,
  today: Date
): UrgencyRule[] {
  const overdue = isOverdue(request, today);
  return [
    { applies: Boolean(school.isSmall), weight: URGENCY_SMALL_SCHOOL, label: 'Kleine Schule' },
    { applies: Boolean(options?.isOutbreak), weight: URGENCY_OUTBREAK, label: 'Häufung' },
    { applies: request.priority === 'UNPLANNED_ABSENCE', weight: URGENCY_PRIORITY_1, label: 'Ungeplanter Ausfall' },
    { applies: overdue, weight: URGENCY_OVERDUE, label: 'Überfällig' },
    { applies: isImminent(request, today, overdue), weight: URGENCY_IMMINENT, label: 'Steht unmittelbar bevor' },
  ];
}

/** Summe der zutreffenden Gewichte. 0 für nicht mehr offene Anfragen (FILLED/CANCELLED/UNFILLED). */
export function requestUrgencyScore(
  request: UrgencyInput,
  school: UrgencySchoolInput,
  options?: UrgencyOptions
): number {
  if (CLOSED_STATUSES.has(request.status)) return 0;
  const today = toLocalDayStart(options?.today ?? new Date());
  return buildRules(request, school, options, today)
    .filter(rule => rule.applies)
    .reduce((sum, rule) => sum + rule.weight, 0);
}

/** Kurze deutsche Labels für die UI, in der gleichen Reihenfolge wie die Gewichte. */
export function urgencyReasons(
  request: UrgencyInput,
  school: UrgencySchoolInput,
  options?: UrgencyOptions
): string[] {
  if (CLOSED_STATUSES.has(request.status)) return [];
  const today = toLocalDayStart(options?.today ?? new Date());
  return buildRules(request, school, options, today)
    .filter(rule => rule.applies)
    .map(rule => rule.label);
}

/**
 * Jeder Tag, den die Anfrage abdeckt, als lokaler YYYY-MM-DD-Schlüssel (analog zu
 * getRequestedDateKeys in matching.ts, hier lokal gehalten, um matching.ts nicht um eine
 * für dieses Modul spezifische Kappung zu erweitern). endDate === null bedeutet ein
 * einzelner Tag. Auf MAX_EXPANSION_DAYS begrenzt, damit ein fehlerhafter Datumsbereich
 * die Berechnung nicht blockiert.
 */
function expandRequestDays(request: UrgencyInput): string[] {
  const start = toLocalDayStart(request.date);
  const end = request.endDate ? toLocalDayStart(request.endDate) : start;
  if (end < start) return [toLocalDateKey(start)];

  const keys: string[] = [];
  const cursor = new Date(start);
  let count = 0;
  while (cursor <= end && count < MAX_EXPANSION_DAYS) {
    keys.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    count += 1;
  }
  return keys;
}

/**
 * Ermittelt je Schule die Tage, an denen mindestens OUTBREAK_THRESHOLD offene Anfragen
 * (PENDING oder PARTIALLY_FILLED) gleichzeitig laufen. Vergangene Tage werden
 * übersprungen, da sie für die aktuelle Priorisierung irrelevant sind.
 */
export function detectOutbreaks(
  requests: (UrgencyInput & { schoolId: string })[],
  options?: { today?: Date }
): Map<string, Set<string>> {
  const today = toLocalDayStart(options?.today ?? new Date());
  const todayKey = toLocalDateKey(today);

  // schoolId -> dayKey -> Anzahl offener Anfragen an diesem Tag
  const counts = new Map<string, Map<string, number>>();

  for (const request of requests) {
    if (!OPEN_STATUSES.has(request.status)) continue;
    const dayKeys = expandRequestDays(request);
    let bySchool = counts.get(request.schoolId);
    if (!bySchool) {
      bySchool = new Map();
      counts.set(request.schoolId, bySchool);
    }
    for (const key of dayKeys) {
      if (key < todayKey) continue;
      bySchool.set(key, (bySchool.get(key) ?? 0) + 1);
    }
  }

  const outbreaks = new Map<string, Set<string>>();
  for (const [schoolId, bySchool] of counts) {
    const days = new Set<string>();
    for (const [dayKey, count] of bySchool) {
      if (count >= OUTBREAK_THRESHOLD) days.add(dayKey);
    }
    if (days.size > 0) outbreaks.set(schoolId, days);
  }
  return outbreaks;
}

/**
 * Ob eine Schule für diese Anfrage als "Häufung" gilt.
 *
 * Vorrang (der Teil, den ein späterer Leser leicht falsch herum annimmt):
 *   1. Eine laufende manuelle Markierung (outbreakUntil >= heute) setzt sich durch -
 *      aber NUR für Anfragetage, die auch in diesen Zeitraum fallen. Sonst bekäme jede
 *      Anfrage der Schule Monate im Voraus die Häufungs-Gewichtung.
 *   2. Eine laufende Abwahl (outbreakDismissedUntil >= heute) unterdrückt eine
 *      automatisch erkannte Häufung, ebenfalls nur für Tage in diesem Zeitraum.
 *   3. Sonst zählt allein die automatische Erkennung.
 *
 * Beide Übersteuerungen sind bewusst befristet: Ein dauerhafter Schalter würde die
 * Automatik verfälschen - eine einmal abgewählte Schule wäre bei der nächsten echten
 * Welle immer noch stumm geschaltet.
 */
export function isSchoolInOutbreak(
  school: UrgencySchoolInput,
  outbreakDays: Map<string, Set<string>>,
  request: UrgencyInput & { schoolId: string },
  options?: { today?: Date }
): boolean {
  const today = toLocalDayStart(options?.today ?? new Date());
  const requestDays = expandRequestDays(request);

  /** Berührt die Anfrage den Zeitraum von heute bis einschließlich `until`? */
  const overlapsOverrideWindow = (until: Date | string): boolean => {
    const end = toLocalDayStart(until);
    if (end < today) return false; // abgelaufen, keine Übersteuerung mehr
    const todayKey = toLocalDateKey(today);
    const endKey = toLocalDateKey(end);
    return requestDays.some(key => key >= todayKey && key <= endKey);
  };

  if (school.outbreakUntil && overlapsOverrideWindow(school.outbreakUntil)) return true;

  const days = outbreakDays.get(request.schoolId);
  if (!days) return false;

  const detectedDays = requestDays.filter(key => days.has(key));
  if (detectedDays.length === 0) return false;

  if (school.outbreakDismissedUntil) {
    const dismissedEnd = toLocalDayStart(school.outbreakDismissedUntil);
    if (dismissedEnd >= today) {
      const dismissedEndKey = toLocalDateKey(dismissedEnd);
      // Nur Tage NACH dem Abwahl-Zeitraum zählen noch als Häufung.
      return detectedDays.some(key => key > dismissedEndKey);
    }
  }

  return true;
}
