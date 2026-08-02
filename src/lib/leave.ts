/**
 * Längere Abwesenheiten über einen Zeitraum.
 *
 * Bewusst OHNE Grund: Mutterschutz, Schwangerschaft oder eine Erkrankung sind
 * Gesundheitsdaten nach Art. 9 DSGVO. Für die Einsatzplanung genügt der Zeitraum, der
 * Grund wird per Dienst-E-Mail oder telefonisch gemeldet (siehe prisma/schema.prisma,
 * Modell LeavePeriod).
 *
 * Diese Datei enthält nur reine Hilfsfunktionen ohne Datenbankzugriff, damit sie
 * sowohl im Server-Code als auch in den Client-Komponenten verwendet werden kann.
 */

function formatDay(value: string | Date): string {
  return new Date(value).toLocaleDateString('de-DE');
}

/** "01.09.2026 – 31.03.2027" bzw. "ab 01.09.2026 (bis auf Weiteres)" */
export function formatLeaveRange(startDate: string | Date, endDate: string | Date | null | undefined): string {
  if (!endDate) return `ab ${formatDay(startDate)} (bis auf Weiteres)`;
  return `${formatDay(startDate)} – ${formatDay(endDate)}`;
}

/** Kurzform für Kennzeichnungen: "Abwesend bis 31.03.2027" bzw. "Abwesend (bis auf Weiteres)" */
export function formatLeaveBadge(endDate: string | Date | null | undefined): string {
  return endDate ? `Abwesend bis ${formatDay(endDate)}` : 'Abwesend (bis auf Weiteres)';
}
