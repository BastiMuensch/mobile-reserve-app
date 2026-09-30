# v0.1.23 – Länger angemeldet bleiben und Push für Schulen

Anmeldungen in Browser und PWA gelten jetzt 90 Tage. Beim Öffnen und bei aktiver Nutzung wird eine noch gültige Sitzung automatisch auf weitere 90 Tage verlängert. Auch bisherige, noch gültige 30-Tage-Sitzungen werden nach dem Update beim nächsten Öffnen mit dem neuen App-Code verlängert. Abgelaufene Sitzungen erfordern weiterhin eine neue Anmeldung; Kontosperren und Passwortzurücksetzungen bleiben sofort wirksam.

Schulen können auf ihren Geräten Push-Benachrichtigungen zu neuen Zuweisungen aktivieren und eine Testnachricht senden. Auf dem Sperrbildschirm erscheinen nur allgemeine Hinweise, die Einsatzdetails bleiben im angemeldeten Portal. Bei Sammelzuweisungen erhält jede betroffene Schule einen Hinweis. Ein Zustellfehler an eine Lehrkraft verhindert die Benachrichtigung der Schule nicht.

Die Detailansicht der Schulamtskennzahlen zeigt verständliche Bezeichnungen der Ausfallarten. Datenschutz- und Betriebsdokumentation, Mail- und Rollout-Pläne sowie die Präsentation für Schulleitungen sind im Quellstand enthalten.

## Update

Keine zusätzliche Datenbankmigration oder Konfigurationsänderung gegenüber 0.1.22. Die Docker-Images `0.1.23` und `latest` werden nach erfolgreichem Release-Workflow veröffentlicht. Laufende Installationen müssen anschließend regulär aktualisiert werden. Für die Sitzungsverlängerung eine bereits geöffnete App nach dem Update neu laden.

## Prüfung

Der gemeinsame Funktionsstand hat lokal Lint, TypeScript, 258 Tests und den Produktionsbuild bestanden. 24 Datenbankintegrationstests wurden lokal mangels Testdatenbank übersprungen. Der Veröffentlichungsworkflow prüft zusätzlich Datenbankintegration und Docker-Laufzeit vor dem Image-Push.
