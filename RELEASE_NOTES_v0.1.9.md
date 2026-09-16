# MobileReserve.digital 0.1.9

## Sicherung und Wiederherstellung

- Passwortverschlüsseltes Vollbackup mit allen App-Daten, Benutzerkonten einschließlich Passwort-Hashes, Einstellungen, technischen Schlüsseln und Uploads.
- Ein eigenes Backup-Passwort pro Export; Anzeige und Kopiermöglichkeit im Download-Dialog.
- Gemeinsamer Einstieg für Vollbackups und bisherige JSON-Sicherungen. Alte JSON-Dateien bleiben importierbar, enthalten jedoch keine vollständigen Logins und Schlüssel.
- Optionaler unabhängiger Wiederherstellungsdienst mit Browser-Assistent, geschütztem Status, Wartungsmodus und kontrolliertem Wechsel auf eine neue Datenbank-/Dateigeneration.
- Prüfung des Backups gegen dieselbe App-Version und denselben Commit. Bei fehlgeschlagenem Wechsel Rückkehr zum bisherigen Stand oder geschlossener Wartungsmodus.
- Bestehende Sitzungen werden nach Wiederherstellung ungültig. Mail, Push und Hintergrundjobs bleiben zunächst pausiert und müssen nach Prüfung ausdrücklich freigegeben werden.
- Betreiber-Anleitung und Terminal-Notfallpfad für Sicherungen und Serverumzüge.

## Wichtig beim Update

Ein normales Image-Update aktiviert den verschlüsselten Download, richtet aber **nicht automatisch die Browser-Wiederherstellung ein**. Dafür muss der Betreiber einmalig die neue `docker-compose.managed.yml` mit eigenem Projektnamen, neuen Volumes und separaten Schlüsseln bereitstellen. Niemals damit bestehende Produktions-Volumes überschreiben oder wiederverwenden.

Die bestehende Installation bleibt mit ihrer bisherigen Compose-Datei nutzbar. Vor dem Update eine aktuelle Datenbank-, Upload- und Konfigurationssicherung erstellen. Domains, DNS, HTTPS/Proxy und andere Serverprogramme sind nicht Teil des App-Vollbackups.

Vollständige Anleitung: `FULL-BACKUP.md`.

## Release-Prüfungen

Lint, TypeScript, Unit-/Schnittstellentests, Produktionsbuild, PostgreSQL-Integrationstests und ein isolierter Docker-Gesamttest für den vollständigen Browser-Wiederherstellungsablauf müssen vor der Veröffentlichung des Images erfolgreich sein.
