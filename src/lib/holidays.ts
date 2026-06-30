export function getHolidayStatus(date: Date): "Ferien" | "Feiertag" | "Wochenende" | null {
  const day = date.getDay();
  if (day === 0 || day === 6) return "Wochenende";

  // Um zeitzonenprobleme zu vermeiden, formatieren wir lokal
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const iso = `${year}-${month}-${d}`;
  
  // Bayerische Feiertage 2025/2026
  const feiertage = [
    "2025-10-03", // Tag der dt. Einheit
    "2025-11-01", // Allerheiligen
    "2025-12-25", // 1. Weihnachtstag
    "2025-12-26", // 2. Weihnachtstag
    "2026-01-01", // Neujahr
    "2026-01-06", // Heilige Drei Könige
    "2026-04-03", // Karfreitag
    "2026-04-06", // Ostermontag
    "2026-05-01", // Tag der Arbeit
    "2026-05-14", // Christi Himmelfahrt
    "2026-05-25", // Pfingstmontag
    "2026-06-04", // Fronleichnam
  ];

  if (feiertage.includes(iso)) return "Feiertag";

  // Bayerische Schulferien 2025/2026
  const ferien = [
    { start: "2025-11-03", end: "2025-11-07" }, // Herbst
    { start: "2025-12-22", end: "2026-01-05" }, // Weihnachten
    { start: "2026-02-16", end: "2026-02-20" }, // Frühjahr
    { start: "2026-03-30", end: "2026-04-10" }, // Ostern
    { start: "2026-05-26", end: "2026-06-05" }, // Pfingsten
    { start: "2026-08-03", end: "2026-09-14" }, // Sommer
  ];

  for (const f of ferien) {
    if (iso >= f.start && iso <= f.end) return "Ferien";
  }

  return null;
}
