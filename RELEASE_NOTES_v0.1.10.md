# MobileReserve.digital 0.1.10

## Einfachere Neuinstallation

- Interaktiver Betreiber-Assistent für neue, getrennte Instanzen: öffentliche HTTPS-Adresse, Gateway-Port und feste App-Version abfragen.
- Unabhängige technische Schlüssel und ein passendes Web-Push-Schlüsselpaar automatisch erzeugen und dauerhaft in einer geschützten Konfiguration speichern.
- Separater vertraulicher Zugangsdatenzettel für Einrichtung und Notfall-Wiederherstellung. Schulamtskonto und Benutzerpasswort werden weiterhin im Browser angelegt.
- Vorhandene Ordner und symbolische Verknüpfungen werden nicht überschrieben. Der Assistent startet keine Container und verändert keine vorhandenen Docker-Volumes.

## Lesender Installationscheck

- Prüfung von Konfiguration, Datenbankverbindung sowie PostgreSQL-16-Sicherungswerkzeugen ohne Änderung von Daten oder Schlüsseln.
- Nach einer verwalteten Wiederherstellung wird die tatsächlich aktive Datenbankgeneration geprüft, nicht die ursprüngliche Datenbank.
- Ungültige Wiederherstellungskonfigurationen und pausierte Generationen werden nicht als betriebsbereit gemeldet.
- Ausgabe ausschließlich von Status und Zählwerten, ohne Passwörter, Schlüssel oder Datensätze.

## Hinweise zum Update

Bestehende Installationen können ihre bisherige Compose-Datei weiterverwenden.
**Keinen Einrichtungsassistenten über eine laufende Installation ausführen und keine bestehenden Schlüssel ersetzen.**
Ein normales Image-Update wandelt die klassische Installation nicht automatisch in eine verwaltete Browser-Wiederherstellungsinstanz um.

Vor dem Update ein aktuelles verschlüsseltes Vollbackup erstellen und das Backup-Passwort getrennt verwahren. Ein Backup aus 0.1.9 benötigt zur Wiederherstellung weiterhin dessen genaue App-Version und Commit; nach dem Update ein neues Backup erzeugen.

Anleitungen: `INSTALLATION.md`, `FULL-BACKUP.md` und `DEPLOYMENT.md`.

## Prüfungen

Automatische Tests decken Schlüsselgenerierung, Dateirechte, Überschreibschutz, sichere Konfiguration und die Auswahl der aktiven Wiederherstellungsdatenbank ab. Vor Veröffentlichung des Images durchläuft GitHub zusätzlich Lint, TypeScript, Produktionsbuild, PostgreSQL-Integrationstests und den vollständigen Docker-Wiederherstellungstest.
