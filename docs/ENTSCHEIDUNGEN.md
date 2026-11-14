# Zentrale Entscheidungen

Bestandsaufnahme am 14.11.2026, kein behauptetes ursprüngliches Entscheidungsdatum. Nur für die betroffene Grundsatzfrage lesen. Fachliche Details stehen in den [Fachregeln](FACHREGELN.md).

## Eine Installation pro Schulamt

Festlegung: Erstinstallation und Betrieb gelten einem Schulamt; kein Web-Superadmin zur Verwaltung weiterer Schulämter.
Folge: Historische `ADMIN`-Datensätze begründen keinen Zugang. Technische Kontowiederherstellung bleibt ein eigener Betriebsweg.
Beleg: [webRoles.ts](../src/lib/webRoles.ts), [auth.ts](../src/lib/auth.ts), [Rollenablauf zur Einzelinstanz](../TESTPLAN.md#2-einzelinstanz-und-technische-kontowiederherstellung).

## Kalendertage getrennt von Zeitstempeln

Festlegung: Berliner Einsatztage werden über Datumsschlüssel kanonisiert.
Grund: Mitternacht, Sommerzeit und unterschiedliche Serverzeitzonen dürfen keine Tage verschieben oder doppelte Belegungen ermöglichen.
Beleg: [dateKey.ts](../src/lib/dateKey.ts), [Datumsregeln](FACHREGELN.md#kalender-und-schuljahre).

## Planung und geleistete Arbeit getrennt halten

Festlegung: Planstunden, Stundenmeldungen und freigegebene Ist-Werte bleiben unterscheidbar; Stornierungen erhalten geschützte Arbeit und Prüfhistorie.
Grund: Eine Planänderung darf dokumentierte Leistung nicht überschreiben.
Beleg: [assignmentHours.ts](../src/lib/assignmentHours.ts), [assignmentWorkProtection.ts](../src/lib/assignmentWorkProtection.ts).

## Mailabsicht mit dem Geschäftsvorgang speichern

Festlegung: Verschlüsselte Outbox-Einträge entstehen in derselben Transaktion; SMTP-Zustellung erfolgt separat mit Wiederholungen.
Grund: Fachliche Speicherung und Benachrichtigung müssen auch bei Mailserverausfällen nachvollziehbar bleiben.
Beleg: [emailOutbox.ts](../src/lib/emailOutbox.ts), [assignService.ts](../src/lib/assignService.ts).

## Pflege

Nur Entscheidungen aufnehmen, deren Grund sich sonst erneut recherchieren ließe oder leicht verloren geht. Format: Datum, Festlegung, Grund, Folgen, Beleg. Abgelöste Entscheidungen als solche kennzeichnen und auf den Nachfolger verweisen; keine unbestätigten Vermutungen als Beschlüsse dokumentieren.
