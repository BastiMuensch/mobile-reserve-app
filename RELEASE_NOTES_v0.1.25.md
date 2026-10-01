# v0.1.25 – Personalübersicht und Einsatzschreiben

## Verbesserungen

- Die Personallisten des Schulamts sind nach Nachnamen sortiert. Bei gleichem Nachnamen entscheidet der Vorname.
- „Heute verfügbar“ berücksichtigt die hinterlegten Einsatztage bei Teilzeit, Montag bis Freitag bei Vollzeit sowie Status und gemeldete Abwesenheiten. Einträge anderer Schuljahre werden nicht als heute verfügbar gezählt.
- Die Detailansicht zu „Heute verfügbar“ zeigt dieselben Personen wie die Kennzahl. Die Beschreibung erläutert, dass bereits zugewiesene Einsätze nicht abgezogen werden.
- Die Schreiben an die Mobilen Reserven enthalten weder „Stunden gesamt“ noch den Abschnitt „Tatsächlich zugewiesene Tage und Stunden“ mit der täglichen Auflistung.

## Technische Hinweise

- Keine Datenbankmigration erforderlich.
- Bereits heruntergeladene PDF-Dateien bleiben unverändert; die Anpassung gilt für neu erzeugte Schreiben.

## Prüfung

Der vollständige Projektcheck mit TypeScript, Produktionsbuild und 264 Tests ist erfolgreich. 24 Datenbankintegrationstests wurden lokal mangels Testdatenbank übersprungen. Lint meldet keine Fehler und sechs bestehende Warnungen in lokalen Präsentationsdateien. Die PDF-Schreiben wurden für einzelne, mehrtägige und stornierte Einsätze sowie lange Vorlagentexte erzeugt, auf die entfernten Angaben geprüft und visuell kontrolliert.
