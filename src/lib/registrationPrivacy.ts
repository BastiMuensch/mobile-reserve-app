import { createHash } from 'node:crypto';
import { z } from 'zod';

export const privacyAcknowledgementSchema = z.object({
  privacyAccepted: z.literal(true, { error: 'Bitte bestätigen Sie den Hinweis zur Datenspeicherung.' }),
  privacyVersion: z.string().regex(/^[a-f0-9]{64}$/, 'Bitte öffnen und bestätigen Sie den aktuellen Datenschutzhinweis.'),
});

/** Factual application notice, supplemented by the operator's configured policy. */
export function registrationPrivacyNotice(policy: string | null | undefined) {
  const text = `## Art und Zweck der Datenspeicherung

Für die Registrierung speichern wir Ihren Namen, Ihre dienstliche E-Mail-Adresse, Ihre Stammschule und gegebenenfalls Ihren Schulamtsbezirk, Ihre postalische Anschrift, die Postleitzahl und die von Ihnen bestätigte Kartenposition. Dazu kommen Qualifikationen, Einsatzpräferenz, Wochenstunden und bei Teilzeit der Verfügbarkeitsstundenplan. Ihr Passwort wird als Hash gespeichert.

Diese Angaben dienen der Einrichtung Ihres Zugangs, der Prüfung und Freischaltung durch das zuständige Schulamt sowie der Planung und Zuordnung von Vertretungseinsätzen. Anschrift und Einsatzdaten werden für dienstliche Schreiben und Nachweise verwendet. Im laufenden Betrieb werden außerdem Einsätze, Bestätigungen, Kontaktdaten und Verfügbarkeiten gespeichert.

Das zuständige Schulamt verwaltet diese Daten. Schulen erhalten die für ihre Einsätze benötigten Angaben zu den zugewiesenen Lehrkräften. Die vollständige Wohnanschrift wird nicht an den Geodienst übertragen. Für den Kartenvorschlag wird nur die Postleitzahl verwendet; den bestätigten Heim-Pin nutzt das Schulamt zur Entfernungsberechnung.

Ihre Bestätigung wird mit Zeitpunkt und dem angezeigten Hinweis gespeichert. Sie bestätigt, dass Sie die Informationen zur Kenntnis genommen haben.

## Datenschutzerklärung des Betreibers

${policy?.trim() || 'Es ist noch keine ergänzende Datenschutzerklärung hinterlegt. Angaben zu Verantwortlichen, Rechtsgrundlage, Speicherdauer und Ihren Datenschutzrechten erhalten Sie beim zuständigen Schulamt.'}`;
  return { text, version: createHash('sha256').update(text).digest('hex') };
}
