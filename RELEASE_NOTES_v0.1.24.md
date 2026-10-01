# v0.1.24 – Besonderheiten bei Bedarfen optional

Schulen können Bedarfe jetzt auch ohne Angaben im Feld für Besonderheiten absenden. Die Pflichtfeldprüfung entfällt im Formular und auf dem Server. Die Beschriftung lautet „Wichtig: Hier Besonderheiten eintragen...“. Der Datenschutzhinweis unter dem Feld bleibt unverändert.

## Update

Keine zusätzliche Datenbankmigration oder Konfigurationsänderung gegenüber 0.1.23 erforderlich.

## Prüfung

TypeScript, Produktionsbuild und 258 Tests bestanden. 24 Datenbankintegrationstests wurden lokal mangels Testdatenbank übersprungen. Lint meldet keine Fehler und sechs bestehende Warnungen in lokalen Präsentationsdateien. Leere, fehlende und nur aus Leerzeichen bestehende Kommentare werden akzeptiert; die Begrenzung auf 2000 Zeichen bleibt wirksam.
