/**
 * Strikte Datumsfunktionen für fachliche Kalendertage (YYYY-MM-DD).
 *
 * Verhindert Phantomdaten (wie 2026-02-31) und Zeitzonenfehler (wie den UTC-Vortag
 * kurz nach Mitternacht durch toISOString()).
 */

const DATE_KEY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

const berlinDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Validiert und parst einen Datumsschlüssel im Format YYYY-MM-DD strikt als
 * reales Kalenderdatum. Werte wie 2026-02-31 oder 2026-04-31 werden abgewiesen.
 *
 * Gibt ein Date-Objekt um UTC-Mitternacht (00:00:00.000Z) für diesen Kalendertag zurück.
 */
export function parseDateKeyStrict(value: string): Date {
  if (typeof value !== 'string') {
    throw new Error('Ungültiger Datumsschlüssel: Wert muss ein String sein.');
  }

  const match = value.match(DATE_KEY_REGEX);
  if (!match) {
    throw new Error(`Ungültiges Datumsformat: "${value}". Erwartet wird YYYY-MM-DD.`);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) {
    throw new Error(`Ungültiger Monat im Datum: ${month}.`);
  }

  // Erzeuge Date in UTC und prüfe, ob die Komponenten unverändert bleiben.
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    throw new Error(`Ungültiges Kalenderdatum: "${value}" existiert nicht im Kalender.`);
  }

  return utcDate;
}

/**
 * Prüft, ob der übergebene Wert ein syntaktisch und kalendarisch gültiges
 * Kalenderdatum im Format YYYY-MM-DD ist.
 */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseDateKeyStrict(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gibt den lokalen Kalendertag für Europe/Berlin im Format YYYY-MM-DD zurück.
 *
 * Verwendet bewusst Intl.DateTimeFormat mit Zeitzone Europe/Berlin anstelle von
 * date.toISOString(), damit kurz nach Mitternacht (z.B. 00:05 Uhr deutscher Zeit)
 * nicht fälschlicherweise der Vortag (22:05 Uhr UTC) ausgegeben wird.
 */
export function toLocalDateInputValue(date: Date = new Date()): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return toLocalDateInputValue(new Date());
  }
  return berlinDateFormatter.format(date);
}

/**
 * Konvertiert ein Date oder einen YYYY-MM-DD-Schlüssel in einen kanonischen
 * UTC-Mitternacht-Zeitstempel (00:00:00.000Z) für denselben Kalendertag in Europe/Berlin.
 *
 * Dies stellt sicher, dass Zuweisungen, Bedarfe und Abwesenheiten in der Datenbank
 * exakt denselben Zeitstempel tragen und der Unique-Index zuverlässig greift.
 */
export function toCanonicalUtcDate(dateOrKey: string | Date): Date {
  if (typeof dateOrKey === 'string') {
    return parseDateKeyStrict(dateOrKey);
  }
  if (dateOrKey instanceof Date) {
    if (Number.isNaN(dateOrKey.getTime())) {
      throw new Error('Ungültiges Date-Objekt für toCanonicalUtcDate.');
    }
    const key = toLocalDateInputValue(dateOrKey);
    return parseDateKeyStrict(key);
  }
  throw new Error('Ungültiger Parameter für toCanonicalUtcDate.');
}

/**
 * Berechnet die inklusive Anzahl von Kalendertagen zwischen zwei Datumsschlüsseln.
 * Beispiel: 2026-05-01 bis 2026-05-01 ergibt 1 Tag.
 */
export function inclusiveCalendarDaysBetween(startKey: string, endKey: string): number {
  const start = parseDateKeyStrict(startKey);
  const end = parseDateKeyStrict(endKey);

  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) {
    throw new Error(`Enddatum (${endKey}) liegt vor Startdatum (${startKey}).`);
  }

  const days = Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1;
  return days;
}
