import { toLocalDayStart, toLocalDateKey } from '@/lib/matching';

/**
 * Zerlegt eine Anforderung in ihre noch offenen Einsatztage.
 *
 * Diese Logik lag bisher nur im Client (openAssignModal im Schulamt-Dashboard) und
 * arbeitete dort mit `toISOString()` – also UTC – während der Wochentag lokal bestimmt
 * wurde. In Zeitzonen östlich von Greenwich fällt ein Einsatz um Mitternacht damit auf
 * den Vortag. Hier wird durchgehend lokal gerechnet (toLocalDayStart/toLocalDateKey),
 * wie im übrigen Server-Code auch.
 *
 * Wochenenden fallen heraus; der Sollbedarf je Tag kommt aus dem `schedule`-JSON der
 * Anforderung ({"1":[1,2],...} je Wochentag, 1 = Montag) oder ersatzweise aus
 * `request.hours`. Bereits vergebene, nicht stornierte Stunden werden abgezogen.
 */

export type RequestForDays = {
  date: Date | string;
  endDate?: Date | string | null;
  hours: number;
  schedule?: string | null;
};

export type AssignmentForDays = {
  date: Date | string;
  hours: number;
  status: string;
};

export type OpenDay = {
  /** Lokaler Tagesschlüssel YYYY-MM-DD */
  date: string;
  /** Noch zu besetzende Stunden an diesem Tag */
  hours: number;
};

/** Schutz vor einem versehentlich absurden Zeitraum (z.B. Tippfehler im Jahr). */
const MAX_DAYS = 400;

function parseSchedule(schedule?: string | null): Record<string, number[]> | null {
  if (!schedule) return null;
  try {
    return JSON.parse(schedule);
  } catch {
    console.warn('[requestDays] Stundenplan der Anforderung ist kein gültiges JSON');
    return null;
  }
}

/**
 * Alle Werktage des Anforderungszeitraums mit ihrem noch offenen Stundenbedarf.
 * Vollständig besetzte Tage fallen heraus.
 */
export function getOpenRequestDays(
  request: RequestForDays,
  assignments: AssignmentForDays[] = []
): OpenDay[] {
  const start = toLocalDayStart(request.date);
  const end = request.endDate ? toLocalDayStart(request.endDate) : start;
  const effectiveEnd = end < start ? start : end;

  const schedule = parseSchedule(request.schedule);

  // Bereits vergebene Stunden je Tag. Stornierte Zuweisungen (Ausfallmeldung) geben
  // ihren Platz wieder frei und zählen deshalb nicht mit.
  const assignedByDay = new Map<string, number>();
  for (const a of assignments) {
    if (a.status === 'REJECTED') continue;
    const key = toLocalDateKey(toLocalDayStart(a.date));
    assignedByDay.set(key, (assignedByDay.get(key) ?? 0) + a.hours);
  }

  const days: OpenDay[] = [];
  const cursor = new Date(start);
  let guard = 0;

  while (cursor <= effectiveEnd && guard < MAX_DAYS) {
    guard += 1;
    const isoWeekday = cursor.getDay() === 0 ? 7 : cursor.getDay(); // 1 = Mo ... 7 = So
    if (isoWeekday <= 5) {
      const key = toLocalDateKey(cursor);
      const required = schedule
        ? (schedule[String(isoWeekday)]?.length ?? 0)
        : request.hours;
      const open = required - (assignedByDay.get(key) ?? 0);
      if (open > 0) days.push({ date: key, hours: open });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Fällt der Zeitraum komplett auf ein Wochenende oder liefert der Stundenplan für
  // keinen Werktag Stunden, bleibt der Starttag als Rückfallebene – sonst ließe sich
  // die Anforderung überhaupt nicht besetzen.
  if (days.length === 0) {
    const alreadyAssigned = assignedByDay.get(toLocalDateKey(start)) ?? 0;
    const open = request.hours - alreadyAssigned;
    if (open > 0) days.push({ date: toLocalDateKey(start), hours: open });
  }

  return days;
}

/** Summe der noch offenen Stunden über alle Tage. */
export function getOpenHours(request: RequestForDays, assignments: AssignmentForDays[] = []): number {
  return getOpenRequestDays(request, assignments).reduce((sum, d) => sum + d.hours, 0);
}
