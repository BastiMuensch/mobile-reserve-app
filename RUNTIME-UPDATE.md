# Sicherheitsupdate der Hauptanwendung: Node.js 24 und Nodemailer

Stand: 09.09.2026. Diese Änderungen betreffen die reguläre Anwendung und ihr
Docker-Image, nicht nur die Demo. Laufende Installationen und bereits exportierte
Demo-Archive werden dadurch nicht automatisch aktualisiert.

## Umfang

- Alle drei Docker-Stufen verwenden `node:24-alpine` statt `node:20-alpine`.
- Nodemailer wird von 9.0.3 auf 9.1.1 aktualisiert; die Lockdatei hält die getestete
  Version fest. Kein Sprung auf Nodemailer 10.
- Node-Typdefinitionen werden auf 24.13.4 aktualisiert; die dadurch benötigten
  `undici-types` wechseln auf 7.18.2.
- Next.js, React, Prisma und die Datenbankschemata bleiben unverändert.
- Erzeugte Dateien unter `output/` und `tmp/` sind vom Typcheck und Linting
  ausgeschlossen. Temporäre Dateien sind außerdem aus Git und Docker-Build-Kontext
  ausgeschlossen, damit PDF-Vorschauen mit Zugangsdaten nicht mitgeliefert werden.

## Zusätzliche Prüfungen

- Offline-Mailtest: Nodemailer verarbeitet Kalender- und PDF-Anhänge, die mit den
  tatsächlichen App-Funktionen erzeugt wurden. Kein Versand an reale Empfänger.
- Login-Integration: falsches/richtiges Passwort, keine Passwortfelder in der
  Antwort, sichere Cookie-Attribute und Widerruf einer Sitzung nach Änderung der
  Kontoversion.
- Der vorhandene Integrationstest-Runner nimmt den Login-Test auf und verlangt
  weiterhin eine ausdrücklich benannte Testdatenbank.
- Der Veröffentlichungsworkflow erhält eine vorgeschaltete Prüfung mit Node 24,
  Lint/Typcheck/Tests/Build, npm-Audit und isolierter PostgreSQL-Datenbank.
  Zusätzlich baut er das Alpine-Image ohne Cache, prüft den nativen Prisma-Zugriff
  im Container und startet die Produktionsanwendung gegen die Testdatenbank.
  Pull Requests dürfen prüfen, aber keine Images veröffentlichen.

## Lokal geprüft / noch erforderlich

Die lokale Prüfung erfolgt unter Node.js 24.14.0 auf macOS. Sie ersetzt keinen
Linux-Alpine-Test. Lint, TypeScript-Prüfung, Produktions-Build und 131
Unit-/Regressionstests sind erfolgreich. Die im normalen Testlauf ausgesparten
Datenbanktests wurden separat ausgeführt: alle 10 Integrationstests erfolgreich,
einschließlich Login, PDF-Berechtigungen, Zuweisungskonflikten und Backup-Rollback.
Die dafür neu angelegte lokale Datenbank heißt
`mobile_reserve_test_node24_20260909` und enthält ausschließlich Testdaten.
Die npm-Audits (Produktionsabhängigkeiten und vollständiger
Baum) meldeten nach dem Update keine bekannten Schwachstellen. Ein sauberer Audit
ist kein vollständiger Sicherheitsnachweis für Anwendung oder Betriebssystem.

Vor Veröffentlichung muss die neue Container-Prüfung auf einem Docker-fähigen
Runner erfolgreich laufen. Docker ist in dieser lokalen Umgebung nicht
verfügbar; der Workflow wurde hier nur strukturell geprüft, nicht remote ausgeführt.
Ein OS-Paket-/Image-Schwachstellenscan bleibt ebenfalls separat erforderlich.
Echter SMTP-Versand inklusive TLS/Authentifizierung ist mit einem ausdrücklich
freigegebenen Testpostfach bei der Bereitstellung zu prüfen.

Es wurde weder ein Release veröffentlicht noch ein laufender Server verändert.
Für den Produktivstart ein geprüftes Release-Tag bzw. einen Image-Digest verwenden.
Die Hauptanwendung darf nicht mit dem Demo-Seed oder `DEMO_MODE=true` gestartet werden.
