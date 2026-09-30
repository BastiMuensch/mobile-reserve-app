# v0.1.21 – Keine falsche Warnung nach dem Speichern

Behebt die Warnung vor ungespeicherten Änderungen beim Verlassen eines bereits gespeicherten Schulprofils. Die separate E-Mail-Einstellung wertete schon ein befülltes Passwort- oder Bestätigungsfeld als Änderung, etwa durch die automatische Befüllung des Browsers.

Die E-Mail-Einstellung warnt jetzt nur, wenn die Adresse tatsächlich vom gespeicherten Wert abweicht. Groß- und Kleinschreibung sowie äußere Leerzeichen werden auf beiden Seiten gleich behandelt. Echte Änderungen am Schulprofil und an der E-Mail-Adresse bleiben geschützt; nach einem fehlgeschlagenen Speicherversuch bleibt die Warnung aktiv.

## Update

Keine zusätzliche Datenbankmigration oder Konfigurationsänderung gegenüber 0.1.20. Die Docker-Images `0.1.21` und `latest` werden nach erfolgreichem Release-Workflow veröffentlicht. Laufende Server müssen anschließend regulär aktualisiert werden.

## Prüfung

Der Fehler wurde im Browser mit dem echten Schulprofil und synthetischen Daten nachgestellt. Geprüft wurden befüllte Bestätigungsfelder ohne Adressänderung, echte Profiländerungen, erfolgreiche Profilspeicherung, fehlgeschlagene und erfolgreiche E-Mail-Speicherung sowie gleichwertige Schreibweisen der Adresse. Typprüfung und Lint waren erfolgreich.
