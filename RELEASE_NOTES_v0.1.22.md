# v0.1.22 – Datenschutzhinweis bei eigenen Ausfallmeldungen

Mobile Reserven sehen bei der Meldung eines eigenen ungeplanten Ausfalls jetzt einen deutlichen Hinweis, keine Gesundheitsdaten, Diagnosen, Symptome oder sonstigen sensiblen persönlichen Details einzutragen. Das Begründungsfeld schlägt eine neutrale Angabe wie „Ungeplanter Ausfall“ vor und erklärt, dass der Text gespeichert und per E-Mail an das Schulamt weitergegeben wird. Vertrauliche Angaben und Nachweise bleiben auf dem vorgesehenen Dienstweg.

Der Hinweis ist für Screenreader mit dem Eingabefeld verknüpft. Auf kleinen Bildschirmen lässt sich der Dialog scrollen. Es gibt keine zusätzliche automatische Inhaltssperre; Speicherung, Versand und Validierung bleiben unverändert.

## Update

Keine Datenbankmigration oder Konfigurationsänderung gegenüber 0.1.21. Die Docker-Images `0.1.22` und `latest` werden nach erfolgreichem Release-Workflow veröffentlicht. Laufende Installationen müssen anschließend regulär aktualisiert werden.

## Prüfung

Der Veröffentlichungsworkflow prüft Lint, TypeScript, Tests und Produktionsbuild sowie Datenbankintegration und Docker-Laufzeit vor dem Image-Push.
