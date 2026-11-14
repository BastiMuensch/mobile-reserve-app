# Arbeitsstand und Übergaben

Nur bei Fortsetzung oder Übergabe lesen. Diese Datei ist kein automatischer Auftrag, alle genannten Punkte abzuarbeiten.

## Aktueller Stand

### Veröffentlichung 0.1.49 · 14.11.2026

- **Umfang:** Stammschulanzeige, geprüfte Tagesänderungen und bayerischer Schulkalender; ausdrücklich einschließlich des bereits vorhandenen Fixes für dauerhaft ausgegraute Bestätigungsknöpfe bei Mobilen Reserven.
- **Bestätigungsfix:** `TeacherNextAssignment.tsx` löst die Bediensperre nach spätestens 30 Sekunden bei hängender Anfrage oder Antwort, zeigt einen dauerhaften Fehlerhinweis und lädt den aktuellen Stand nach; erneutes Bestätigen verwendet die ausdrücklich ausgewählten IDs.
- **Prüfung:** Gemeinsamer `npm run check` erfolgreich (609 Tests, 39 ohne Testdatenbank übersprungen). Separater Integrationslauf: 116 Tests inklusive Backup/Wiederherstellung erfolgreich. Bestätigungsfix zusätzlich in Chromium und WebKit bei 320, 390 und 1440 Pixeln mit Touch, Zeitüberschreitung, Wiederholung und Sitzungsablauf geprüft.
- **Dateien:** [Bestätigung](../src/components/teacher/TeacherNextAssignment.tsx), [Browserregression](../scripts/check-assignment-confirmation.mjs), [Migration](../prisma/migrations/20261114120000_request_lesson_changes/migration.sql); weitere Prüfungen im [Testplan](../TESTPLAN.md).
- **Release:** Version 0.1.49 bündelt diesen Umfang; Veröffentlichungs- und Containerstatus vor einem Rollout prüfen. Beim Containerstart wird die neue Migration angewendet. Alte Zuweisungen an unterrichtsfreien Tagen im Schulamt prüfen; noch keine produktive Migration ausgeführt.

Andere laufende Arbeiten sind hier noch nicht verifiziert erfasst. Aus einem leeren Übergabestand folgt nicht, dass das gesamte Projekt abgeschlossen oder der Worktree sauber ist. Bei Fortsetzung zuerst `git status --short` und die betroffenen Änderungen prüfen.

## Übergabeformat

Nur bei tatsächlich offener Arbeit einen eigenen Eintrag anlegen; fremde Einträge erhalten. Pro Aufgabe möglichst höchstens zehn kurze Zeilen:

- **Aufgabe / Datum / Branch:** konkretes Ziel und Zuordnung.
- **Stand:** was umgesetzt ist, was noch fehlt.
- **Dateien:** nur die relevanten Pfade oder Symbole.
- **Prüfung:** Befehl, Ergebnis, geprüfter Commit oder „uncommitted“; ausgelassene Prüfungen nennen.
- **Entscheidung / Blocker:** nur bestätigte Festlegungen und tatsächlich offene Fragen.
- **Nächster Schritt:** eine konkrete Fortsetzung.

Nach Abschluss den Eintrag entfernen; dauerhaft wichtige Gründe vorher in [Entscheidungen](ENTSCHEIDUNGEN.md), Regeln in [Fachregeln](FACHREGELN.md) übernehmen. Keine Chatprotokolle, Testlogs, Geheimnisse oder vollständigen Änderungslisten ansammeln. Teststände nach späteren Änderungen erneut bewerten.
