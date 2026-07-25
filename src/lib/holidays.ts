// ============================================================================
// WARTUNGSHINWEIS
// ----------------------------------------------------------------------------
// Die bayerischen SCHULFERIEN (siehe FERIEN_NACH_SCHULJAHR unten) werden je
// Schuljahr behördlich festgelegt und sind daher NICHT berechenbar. Sie sind
// aktuell gepflegt bis einschließlich Schuljahr 2026/2027, d.h. bis zum
// 13.09.2027 (Ende der Sommerferien 2027). Ab dem Schuljahr 2027/2028 muss
// diese Liste ergänzt werden, sobald das Staatsministerium die Termine
// veröffentlicht hat - siehe https://www.km.bayern.de/termine/ferien-und-feiertage
//
// Aufrufer können mit isDateCoveredByMaintainedFerien() prüfen, ob ein Datum
// noch von dieser Liste abgedeckt ist, um stille Falschangaben zu vermeiden.
//
// Stand dieser Pflege: 25.07.2026.
// ============================================================================

type Ferienzeitraum = { start: string; end: string; label: string };

// Bayerische Schulferien nach Schuljahr (Format "YYYY/YYYY").
// Quelle: https://www.km.bayern.de/termine/ferien-und-feiertage (amtliche
// Übersicht des Bayerischen Staatsministeriums für Unterricht und Kultus),
// abgeglichen mit mehreren unabhängigen Ferienkalendern. Stand: 25.07.2026.
// Termine für Schuljahre ab 2027/2028 waren zu diesem Zeitpunkt auf der
// amtlichen Seite noch nicht veröffentlicht und wurden daher bewusst NICHT
// ergänzt (siehe Wartungshinweis oben).
const FERIEN_NACH_SCHULJAHR: Record<string, Ferienzeitraum[]> = {
  "2025/2026": [
    { start: "2025-11-03", end: "2025-11-07", label: "Herbstferien" },
    { start: "2025-12-22", end: "2026-01-05", label: "Weihnachtsferien" },
    { start: "2026-02-16", end: "2026-02-20", label: "Frühjahrsferien" },
    { start: "2026-03-30", end: "2026-04-10", label: "Osterferien" },
    { start: "2026-05-26", end: "2026-06-05", label: "Pfingstferien" },
    { start: "2026-08-03", end: "2026-09-14", label: "Sommerferien" },
  ],
  "2026/2027": [
    { start: "2026-11-02", end: "2026-11-06", label: "Herbstferien" },
    { start: "2026-12-24", end: "2027-01-08", label: "Weihnachtsferien" },
    { start: "2027-02-08", end: "2027-02-12", label: "Frühjahrsferien" },
    { start: "2027-03-22", end: "2027-04-02", label: "Osterferien" },
    { start: "2027-05-18", end: "2027-05-28", label: "Pfingstferien" },
    { start: "2027-08-02", end: "2027-09-13", label: "Sommerferien" },
  ],
};

const ALL_FERIEN: Ferienzeitraum[] = Object.values(FERIEN_NACH_SCHULJAHR).flat();

// The envelope of dates actually covered by FERIEN_NACH_SCHULJAHR. Used by
// isDateCoveredByMaintainedFerien() below.
const MAINTAINED_FERIEN_RANGE = ALL_FERIEN.reduce(
  (range, f) => ({
    earliest: f.start < range.earliest ? f.start : range.earliest,
    latest: f.end > range.latest ? f.end : range.latest,
  }),
  { earliest: ALL_FERIEN[0].start, latest: ALL_FERIEN[0].end }
);

// Um Zeitzonenprobleme zu vermeiden, formatieren wir Daten immer lokal (nicht über toISOString/UTC).
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Gaußsche Osterformel - berechnet den Ostersonntag (gregorianischer Kalender) für ein Jahr.
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Buß- und Bettag: der Mittwoch vor dem 23. November (in Bayern kein gesetzlicher
// Feiertag, aber unterrichtsfrei).
function getBussUndBettag(year: number): Date {
  const nov23 = new Date(year, 10, 23);
  const dayOfWeek = nov23.getDay(); // 0 = Sonntag ... 3 = Mittwoch ... 6 = Samstag
  let daysBack = (dayOfWeek - 3 + 7) % 7;
  if (daysBack === 0) daysBack = 7; // "vor" dem 23. - fällt der 23. selbst auf Mittwoch, gilt die Vorwoche
  return addDays(nov23, -daysBack);
}

// Berechnet alle bayerischen gesetzlichen Feiertage (plus den unterrichtsfreien
// Buß- und Bettag) für ein Kalenderjahr - algorithmisch statt hartkodiert, damit
// die Feiertagslogik unbegrenzt in die Zukunft gilt.
function getBavarianHolidaysForYear(year: number): Set<string> {
  const easterSunday = getEasterSunday(year);

  const dates: Date[] = [
    new Date(year, 0, 1),        // Neujahr
    new Date(year, 0, 6),        // Heilige Drei Könige
    addDays(easterSunday, -2),   // Karfreitag
    addDays(easterSunday, 1),    // Ostermontag
    new Date(year, 4, 1),        // 1. Mai (Tag der Arbeit)
    addDays(easterSunday, 39),   // Christi Himmelfahrt
    addDays(easterSunday, 50),   // Pfingstmontag
    addDays(easterSunday, 60),   // Fronleichnam
    new Date(year, 7, 15),       // Mariä Himmelfahrt
    new Date(year, 9, 3),        // Tag der Deutschen Einheit
    new Date(year, 10, 1),       // Allerheiligen
    new Date(year, 11, 25),      // 1. Weihnachtstag
    new Date(year, 11, 26),      // 2. Weihnachtstag
    getBussUndBettag(year),      // Buß- und Bettag (unterrichtsfrei)
  ];

  return new Set(dates.map(toIsoDate));
}

export function getHolidayStatus(date: Date): "Ferien" | "Feiertag" | "Wochenende" | null {
  const day = date.getDay();
  if (day === 0 || day === 6) return "Wochenende";

  const iso = toIsoDate(date);

  const feiertage = getBavarianHolidaysForYear(date.getFullYear());
  if (feiertage.has(iso)) return "Feiertag";

  for (const f of ALL_FERIEN) {
    if (iso >= f.start && iso <= f.end) return "Ferien";
  }

  return null;
}

// Prüft, ob ein Datum innerhalb des Zeitraums liegt, für den die Schulferientermine
// (FERIEN_NACH_SCHULJAHR) tatsächlich gepflegt sind. Feiertage sind davon nicht
// betroffen (die werden unbegrenzt berechnet) - es geht ausschließlich um die
// behördlich festgelegten Ferientermine. Aufrufer (z.B. PDF-Export) sollten bei
// `false` einen sichtbaren Hinweis anzeigen statt stillschweigend "kein Ferientag"
// anzunehmen.
export function isDateCoveredByMaintainedFerien(date: Date): boolean {
  const iso = toIsoDate(date);
  return iso >= MAINTAINED_FERIEN_RANGE.earliest && iso <= MAINTAINED_FERIEN_RANGE.latest;
}
