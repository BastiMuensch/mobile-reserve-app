# Demo Sonnenhain – bestehende Instanz ersetzen

## Inhalt und Grenzen

- Ein fiktives Schulamt, sechs Schulen, zwölf Lehrkräfte (zehn aktuelle aktive, eine im Warteraum, eine ausschließlich im Vorjahr zur Übernahme).
- 25 Anfragen an Werktagen vom **14.09.2026 bis 16.10.2026**: zehn offen, fünf teilweise besetzt, zehn vollständig besetzt. 15 zugehörige Zuweisungen, keine stornierten und keine Einsätze vor dem Startdatum. Das Datum bleibt fest; nach diesen Terminen liegen sie natürlich in der Vergangenheit.
- Teilzeit, eine tagesbezogene und eine längere Abwesenheit ab dem Startdatum. Keine medizinischen Details.
- Fiktive Namen, Adressen und Beispielpins im Raum München; `.example`-Adressen sind keine zustellbaren Dienstadressen. Die Pins behaupten keine realen Schul- oder Wohnstandorte.
- Demo-Briefkopf und Demo-Betreff; der BayTGV-Text wird unverändert aus dem Datenbankschema übernommen. Keine echte Unterschrift, keine übernommenen Schulbilder. Das mitgelieferte App-Logo bleibt erhalten.
- Die separate Datei `ZUGANGSDATEN.md` enthält alle 19 zufällig erzeugten Konto-Passwörter. Die Seeddatei enthält ausschließlich Passwort-Hashes. Das Warteraumkonto funktioniert erst nach Freischaltung; das Vorjahreskonto ist für die Übernahme vorgesehen.
- Die Demo ist **voll bedienbar, nicht schreibgeschützt**. Nur ausgewählten Interessenten Zugang geben; ein Schulamtskonto kann fachliche Daten verändern/löschen. Keine echten personenbezogenen Daten eingeben. Impressum/Datenschutzhinweise des tatsächlichen Betreibers vor öffentlicher Bereitstellung separat eintragen; dafür werden bewusst keine fiktiven Rechtsangaben erzeugt.

## Wichtig: neuer Anwendungsstand erforderlich

**Nicht allein in Version 0.1.6 importieren.** Dieses Paket ergänzt eine serverseitige `demoMode`-Versandsperre. Ohne den neuen Anwendungsstand wäre Geräte-Push nicht dauerhaft gesperrt. `mailProvider=NONE` und leere Abonnements allein genügen nicht.

Der normale Backup-Import der Weboberfläche ist NICHT der Importweg für diese Datei. Das separate Skript ersetzt alle Anwendungstabellen einschließlich Konten, SMTP-Konfiguration, Einladungen, Reset-Tokens, Push-Abos, Mailwarteschlange und alten Upload-Dateien. Es setzt den nicht über die Oberfläche editierbaren `demoMode=true`. Mail-Queue, SMTP-Versand und Push-Versand/-Registrierung werden dadurch serverseitig unterbunden, selbst wenn später SMTP-Einstellungen eingegeben werden.

## Vorbereitung auf deinem Homeserver (Service `web`)

Diese Anleitung verwendet deinen bereits ermittelten Compose-Service **web** (die Beispiel-Compose im Quellrepository nennt ihn dagegen `app`). Nur die tatsächlich bestehende Compose-Datei verwenden. Zuerst prüfen:

```bash
sudo docker compose config --services
```

1. Vollständiges Backup über die App herunterladen. Zusätzlich die bestehende Compose-Datei, `.env`/Server-Schlüssel und externe Konfiguration sicher außerhalb der öffentlich erreichbaren Verzeichnisse aufbewahren. Diese Serverdateien sind NICHT Bestandteil des automatischen Datenbank-/Upload-Backups.
2. Das Paket außerhalb des Quellcodes in einem lokalen Ordner entpacken. Zugangsdaten separat und nicht öffentlich aufbewahren.
3. Für den sofortigen Einsatz ohne neues Release: im sauberen Quellcheckout von **v0.1.6** `git apply --check /PFAD/ZUM/PAKET/runtime.patch` und danach `git apply /PFAD/ZUM/PAKET/runtime.patch` ausführen. Die Dateien `scripts/demo-seed.mjs` und `scripts/demo-data.mjs` aus dem Paket unter `scripts/` in diesen Checkout kopieren. Anschließend `sudo docker build -t mobile-reserve-demo:local .`. Kein Image mit privaten Zugangsdaten oder Backup-Dateien im Build-Kontext bauen. Alternativ einen später veröffentlichten Release-Stand mit diesem Feature verwenden.
4. Neben der bestehenden Compose-Datei ein **neues** Verzeichnis `demo-work` anlegen und ausschließlich `demo-seed.json` hineinlegen. Die mitgelieferte `compose.demo.yml` ebenfalls neben die bestehende Compose-Datei legen. Wenn solche Dateien/Ordner bereits existieren, nicht blind überschreiben.
5. `demo-work` für die Container-UID 1000 les-/schreibbar machen und vor anderen Benutzern schützen. Beispiel für den neu angelegten Ordner: `sudo chown 1000:1000 demo-work demo-work/demo-seed.json`, `sudo chmod 700 demo-work`, `sudo chmod 600 demo-work/demo-seed.json`. Backups werden darin angelegt; genug freien Speicher vorhalten.
6. Prüfen, dass der vorhandene `web`-Service beide dauerhaften Upload-Verzeichnisse mountet: `/app/public/uploads` und `/app/private-uploads`. Nicht persistierte Uploads vorher aus dem bisherigen Container sichern und dauerhaft bereitstellen. Das Seed-Skript darf nicht in einen frischen Container mit leeren Ersatz-Volumes blicken, während die echten Dateien anderswo liegen.

## Vorschau und ausdrückliches Ersetzen

Vor dem Ersetzen **web und alle weiteren App-/Worker-Instanzen stoppen**, PostgreSQL laufen lassen:

```bash
sudo docker compose stop web
sudo docker compose -f docker-compose.yml -f compose.demo.yml run --rm --no-deps --entrypoint node web scripts/demo-seed.mjs --seed /app/demo-work/demo-seed.json
```

Die Vorschau verändert nichts. Sie zeigt die Ziel-Datenbank, vorhandene Datensatzanzahlen und eine individuelle Bestätigungszeichenfolge `ERSETZEN:HOST:PORT/DATENBANK:DATEIPRÜFSUMME`. Ziel sorgfältig prüfen; diese Zeichenfolge wird nicht vorab geraten.

Erst dann mit der **exakt ausgegebenen** Zeichenfolge ausführen:

```bash
sudo docker compose -f docker-compose.yml -f compose.demo.yml run --rm --no-deps --entrypoint node web scripts/demo-seed.mjs --seed /app/demo-work/demo-seed.json --apply 'EXAKTE_BESTÄTIGUNG_AUS_DER_VORSCHAU' --backup-dir /app/demo-work/backup-vor-demo
```

Das Backup-Verzeichnis darf noch nicht existieren. Das Skript:

1. Verweigert die Umstellung bei anderen Datenbankverbindungen, unerwartetem Schema oder unsicheren Upload-/Backup-Pfaden.
2. Erstellt einen vollständigen PostgreSQL-Dump einschließlich Passwort-Hashes und SMTP-Daten sowie Kopien aller Dateien in beiden Upload-Verzeichnissen. Diese Sicherung ist **vertraulich und nicht verschlüsselt**; Dateirechte 0600/Verzeichnisrechte 0700. Außerhalb der Webverzeichnisse geschützt aufbewahren.
3. Prüft Dump-Lesbarkeit und Datei-Prüfsummen. Ersetzt alle Anwendungsdaten in einer Datenbanktransaktion. Bei Datenfehlern wird die Transaktion zurückgerollt. Zufällige Sitzungsversionen machen auch frühere Demo-Sitzungen ungültig.
4. Entfernt danach die alten Upload-Dateien. Dateien und Datenbank können nicht gemeinsam atomar geändert werden: bei einem Fehler **nicht neu starten**, sondern Backup und Fehlermeldung prüfen. Die Sicherung bleibt erhalten.
5. Schreibt nur nach vollständigem Erfolg `backup-vor-demo/ERFOLGREICH.txt`.

Nur nach Erfolg starten (den Override weiter verwenden, damit der neue Demo-Code aktiv bleibt):

```bash
sudo docker compose -f docker-compose.yml -f compose.demo.yml up -d --no-deps web
```

Nicht anschließend versehentlich mit der alten `:latest`-Version 0.1.6 starten. Das Demo-Image und die Backups zunächst aufbewahren. Es gibt keinen automatischen Reset, keine automatische Seed-Ausführung beim Start und keinen automatischen Mailversand.

## Wiederherstellung

App und Worker gestoppt lassen. `database.dump` ist ein gewöhnliches PostgreSQL-Custom-Format-Backup. Ein Administrator kann es mit `pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error` in die ausdrücklich geprüfte Zieldatenbank zurückspielen (Verbindung/Passwort sicher über die lokale PostgreSQL-Konfiguration setzen). Im isolierten Test wurde genau diese Wiederherstellung tatsächlich ausgeführt, nicht nur die Dump-Liste geprüft.

Danach die Dateien aus `uploads-0/` nach `/app/public/uploads/` und `uploads-1/` nach `/app/private-uploads/` zurückkopieren, passende Rechte für UID 1000 herstellen und die ursprüngliche App-/Compose-/Schlüsselkonfiguration wiederverwenden. `manifest.json` dokumentiert Originalpfade und Prüfsummen. Die Sicherung enthält echte Altdaten und darf niemals für Demo-Interessenten bereitgestellt werden. Bei bereits veränderten Demo-Uploads vor dem Zurückkopieren deren vollständige Entfernung separat planen.

## Andere Starttermine / Tests

Neu generieren, ohne eine Datenbank zu verändern:

```bash
node scripts/demo-seed.mjs --generate output/neue-demo --start 2027-09-13
```

Jede Generierung erstellt neue Passwörter; immer die zugehörige separate Zugangsdaten-Datei verwenden. Das Verzeichnis darf noch nicht existieren. Zum regelmäßigen Zurücksetzen kann dieselbe Seeddatei nach erneutem Backup und ausdrücklicher Bestätigung verwendet werden.

Tests: `tests/demoData.test.ts`, `scripts/check-demo-seed.mjs` (ausschließlich explizite lokale `_test_demo_`-Datenbank) und `scripts/check-demo-browser.mjs` (nur Loopback-App mit diesem Seed). Geprüft wurden alle 19 Konten, die drei Rollenansichten, PDF-Erzeugung, Versand­sperren, vollständiges Backup/Restore, Upload-Entfernung, Rollback und Sitzungsversionen. Produktionsinstallation wurde nicht verändert.
