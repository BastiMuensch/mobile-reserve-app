# v0.1.20 – Schulbilder sofort anzeigen

Behebt einen Fehler beim Bild-Upload im Schulprofil: Nach dem Serverstart hochgeladene Bilder waren im Produktionsbetrieb nicht erreichbar; auch die Bildvorschau schlug fehl. Neue Schulbilder werden jetzt zur Laufzeit ausgeliefert und sind ohne Serverneustart sichtbar.

- JPEG, PNG, GIF und WebP funktionieren einschließlich der Bildvorschau. Der Wiederherstellungs-Gateway unterstützt nun ebenfalls GIF-Dateien.
- Die Dateiendung wird aus dem geprüften Bildtyp abgeleitet, auch bei Bildern ohne passende ursprüngliche Dateiendung.
- Das Schulprofil zeigt die erlaubten Formate und die Grenze von 5 MB an. Ungeeignete Dateien werden bereits bei der Auswahl zurückgewiesen; Fehler beim Speichern werden genauer angezeigt.
- Sicherheitsupdates für Nodemailer sowie die indirekten Abhängigkeiten brace-expansion, fast-uri, ip-address und undici beheben die im Release-Prüflauf gemeldeten Schwachstellen.

## Update

Keine zusätzliche Datenbankmigration gegenüber 0.1.19. Bestehende Daten, Upload-Verzeichnisse und Konfiguration beibehalten. Das Docker-Image `0.1.20` und `latest` werden nach erfolgreichem Release-Workflow veröffentlicht. Laufende Server müssen anschließend regulär aktualisiert werden.

## Prüfung

Der Fehler wurde lokal im Produktionsmodus reproduziert. Nach der Korrektur waren neue JPEG-, PNG-, GIF- und WebP-Dateien samt Bildvorschau sofort abrufbar. Neun gezielte Tests für Bildauslieferung, geschützte Dateipfade und Gateway bestanden; Typprüfung und Produktionsbuild waren erfolgreich.

Nach den Sicherheitsupdates bestanden außerdem 244 lokale Tests, darunter der Mailtest mit Kalender- und PDF-Anhängen. 24 Datenbanktests wurden lokal mangels Testdatenbank übersprungen und werden durch die Release-Pipeline abgedeckt. Die Paketprüfung meldet keine bekannten Schwachstellen.
