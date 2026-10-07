# Bestehende Homeserver-Demo aktualisieren

Das Update enthält den aktuellen App-Code mit allen Datenbankmigrationen. `.env`, `data/`, Zugangsdaten und laufende Demodaten sind nicht im Update enthalten und bleiben bestehen. Die Versionsnummer steht im Archivnamen und in `app/package.json`.

## Update aufspielen

1. Das Archiv `MobileReserve-Demo-Update-VERSION.tar.gz` in den bestehenden Demo-Ordner `/volume2/docker_data/docker/mobile-reserve-demo` hochladen.
2. Per SSH anmelden und das Update dort entpacken. Das überschreibt nur die App-Dateien und Demo-Skripte:

```bash
ssh Basti@Homeserver
cd /volume2/docker_data/docker/mobile-reserve-demo
sudo tar -xzf MobileReserve-Demo-Update-VERSION.tar.gz
sudo sh update.sh
```

Das Skript baut zuerst die neue App, prüft die Demo-Instanz, stoppt die Demo kurz und sichert Datenbank, hochgeladene Dateien, `.env` und die ursprünglichen Demodaten unter `backups/update-…/`. Anschließend führt es alle ausstehenden Migrationen aus und startet die neue Version. Der Initialisierungsschritt läuft bei jedem Update ausdrücklich erneut; bestehende Daten werden dabei erkannt und behalten.

Die bisherige Domain, der Port, Pangolin, alle Passwörter und bereits angelegte Anfragen bleiben erhalten. E-Mail und Geräte-Push bleiben im Demomodus gesperrt. Das Update fügt keine neuen Beispieldaten in die bestehende Datenbank ein. Neue Schulstandorte und Qualifikationsangaben können nach dem Update über die Oberfläche ergänzt werden.

## Prüfen

Nach der Erfolgsmeldung die Demo unter **https://demo.bdb-uamm.de** neu laden und mit einem vorhandenen Zugang anmelden. Im Schulamtskonto sind unter anderem die aktuelle Tagesplanung, mehrere Schulstandorte, Stammschulübersichten und Qualifikationsangaben verfügbar.

Bei einem Fehler:

```bash
sudo docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml ps -a
sudo docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml logs --tail=100 demo-web
```

Bei fehlgeschlagener Sicherung oder Migration bleibt die Web-App gestoppt. Die Fehlermeldung des einmaligen Migrationscontainers steht direkt im Terminal. Nach Behebung der Ursache kann `sudo sh update.sh` erneut ausgeführt werden. Sicherungen unverändert aufbewahren; `.env` und Zugangsdaten nicht öffentlich weitergeben. Eine Rückkehr zur alten App nach einer Migration erfordert eine zur alten Version passende Datenbanksicherung.

`reset.sh` ist für dieses Update nicht erforderlich. Es würde ausdrücklich alle Demoänderungen auf den ursprünglichen Beispieldatenstand zurücksetzen.

## Pakete künftig erzeugen

Im Entwicklungsprojekt erzeugt `node scripts/package-demo.mjs` ein Update-Paket für die Version aus `package.json`. Vorhandene Ausgaben werden nicht überschrieben; bei Bedarf mit `--output output/ANDERER-NAME` ein anderes Ziel wählen.

Für eine komplett neue, unabhängige Demo zunächst Beispieldaten mit einem passenden Startdatum erstellen und danach ein eigenständiges Paket bauen:

```bash
node scripts/demo-seed.mjs --generate output/demo-neu --start 2026-10-12
node scripts/package-demo.mjs --seed-dir output/demo-neu
```

Dieses eigenständige Paket enthält neue Servergeheimnisse und einen eigenen Demodatenstand. Es darf nicht über die bestehende Demo entpackt werden. Die separate Datei mit den Zugangsdaten liegt neben dem Archiv. Frische Beispieldaten zeigen auch Außenstellen, eine kombinierte Grund- und Mittelschule, Qualifikationen und eine Reserve mit Beschränkung auf ihre Stammschule.
