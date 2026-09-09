# Eigenständige Demo auf dem Homeserver

Dieses Paket ersetzt **nichts** an deiner bestehenden Installation. Es enthält den nötigen Quellcode, eine eigene Compose-Konfiguration und fiktive Daten ab 14.09.2026. Es verwendet weder das bisherige `web` noch dessen Datenbank. Nicht in dessen Projektverzeichnis entpacken.

## 1. Paket auf den Server kopieren

In der Dateiverwaltung des UGREEN-NAS unter `/volume2/docker_data/docker/` den **neuen** Ordner `mobile-reserve-demo` anlegen. Das Archiv `MobileReserve-Demo-Eigenstaendig.tar.gz` dort hochladen und direkt in diesem Ordner entpacken. Danach müssen `compose.yml`, `.env`, `start.sh`, `reset.sh`, `data/` und `app/` nebeneinander liegen (nicht noch in einem zusätzlichen Unterordner).

Die Datei `.env` ist versteckt und enthält ausschließlich neu erzeugte Demo-Servergeheimnisse. Nicht durch die `.env` der bestehenden App ersetzen. Die separate Datei `DEMO-ZUGANGSDATEN.md` auf deinem Rechner behalten und nur die benötigten Rollen-Zugänge an Interessenten weitergeben. Sie enthält außerdem die Demo-Datenbank-Zugangsdaten und Verweise auf die Schlüsseldatei.

## 2. Per SSH anmelden

Auf deinem Mac im Terminal:

```bash
ssh Basti@Homeserver
cd /volume2/docker_data/docker/mobile-reserve-demo
ls -la
sudo docker compose version
sudo ss -lntup 'sport = :3110'
```

Benötigt Docker mit Compose v2, Internetzugang zum Herunterladen der Build-Abhängigkeiten und mehrere GB freien Speicher. Bei der Portprüfung darf keine belegte Listener-Zeile erscheinen. Laut CloudInfra hat das NAS die LAN-Adresse `192.168.1.56`; falls sich diese geändert hat, vor dem Start `DEMO_BIND_IP=NEUE_NAS_IP` in der Demo-`.env` ergänzen und das Pangolin-Ziel entsprechend ändern. Der erste Build benötigt einige Minuten und RAM. Bei einem Abbruch bleibt die bestehende Installation unverändert. Keine Änderungen an ihrer Compose-Datei vornehmen.

## 3. Demo starten

```bash
sudo sh start.sh
```

Das Skript baut ein eigenes Image (`mobile-reserve-demo-sonnenhain:local`), startet eine eigene PostgreSQL-16-Datenbank, führt die Migrationen aus und füllt ausschließlich die leere Demo-Datenbank. Erst danach startet die Web-App. Keine Dateien patchen, keine Datenbank manuell anlegen, keine Produktionszugangsdaten eintragen.

Bei einer späteren Ausführung werden vorhandene Demodaten **nicht** erneut eingespielt. Die zufällige Instanz-ID in `.env` verhindert das automatische Überschreiben einer fremden/belegten Datenbank. `.env` also sicher aufbewahren und bei Updates nicht neu erzeugen.

Prüfen:

```bash
sudo docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml ps -a
sudo docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml logs --tail=100 demo-init demo-web
```

`demo-init` soll nach der Einrichtung **Exited (0)** sein – das ist beabsichtigt. `demo-db` und `demo-web` sollen laufen. Bei einem Build-/Startfehler die letzten Zeilen der Ausgabe schicken, aber **keine `.env` oder Passwörter**.

## 4. Zunächst auf deinem Mac ausprobieren

Die Demo lauscht auf `192.168.1.56:3110` im LAN, damit der vorhandene Newt-Container sie erreichen kann. Kein Router-Port wird freigegeben. Zum optionalen Vorabtest auf deinem Mac in einem **zweiten** Terminal öffnen:

```bash
ssh -N -L 3110:192.168.1.56:3110 Basti@Homeserver
```

Terminal offen lassen und im Browser **http://localhost:3110** öffnen. Mit `schulamt@sonnenhain.example` und dem Passwort aus `DEMO-ZUGANGSDATEN.md` anmelden. Schule und Mobile Reserve haben jeweils eigene Zugänge. Ein Warteraumkonto ist absichtlich bis zur Freischaltung gesperrt; eine Lehrkraft liegt im Vorjahr für die Übernahme-Demo.

Wenn Port 3110 auf deinem Mac bereits belegt ist, zum Beispiel `ssh -N -L 3111:192.168.1.56:3110 Basti@Homeserver` verwenden und `http://localhost:3111` öffnen.

Nicht einfach `http://Homeserver:3110` freigeben: produktive Sitzungscookies benötigen einen sicheren Browserkontext. Der Tunnel verwendet `localhost`; für externe Besucher HTTPS verwenden.

## 5. Für Interessenten über HTTPS freigeben

Die Adresse **https://demo.bdb-uamm.de** ist bereits im Paket eingetragen. Der DNS-Eintrag dieser Subdomain muss auf euren bestehenden Pangolin-VPS zeigen (nicht auf die private NAS-IP). Bestehenden Wildcard-DNS-Eintrag gegebenenfalls weiterverwenden.

In **Pangolin** eine neue HTTP-Ressource anlegen und den bereits verbundenen **Newt-Endpunkt des NAS** auswählen:

- Öffentliche Adresse: `https://demo.bdb-uamm.de`.
- Internes Ziel: Protokoll HTTP, Hostname `192.168.1.56`, Port `3110`.
- HTTPS/Zertifikat wie bei euren bestehenden Ressourcen über Pangolin bereitstellen.

Die bisherige App-Ressource nicht ändern. Keinen zusätzlichen lokalen Proxy installieren und keine Ports im Router freigeben. Newt erreicht den neuen NAS-Port über das LAN; HTTPS endet wie bei euren anderen Diensten auf dem VPS. Ein gegebenenfalls aktivierter Pangolin-Zugangsschutz bleibt eine zusätzliche Anmeldung vor der App; für Interessenten entsprechend Zugänge vorsehen.

Die mitgelieferte Demo-`.env` enthält bereits:

```dotenv
DEMO_PUBLIC_URL=https://demo.bdb-uamm.de
```

Nur bei einer späteren Änderung der URL neu übernehmen:

```bash
sudo docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml up -d --force-recreate demo-web
```

Danach https://demo.bdb-uamm.de öffnen und einen Rollen-Login prüfen. Vor externer Veröffentlichung echte Betreiberangaben für Impressum/Datenschutzhinweise eintragen. Keine fiktiven Rechtsangaben sind voreingetragen.

## 6. Demo bei Bedarf zurücksetzen

Das löscht ausschließlich die Änderungen innerhalb dieser Demo und stellt den mitgelieferten Stand wieder her. Die vorhandenen Zugangsdaten gelten danach wieder. Es wird vorher ein Datenbank-/Upload-Backup im eigenen Wartungsvolume erstellt.

```bash
sudo sh reset.sh NUR-DEMO-ZURUECKSETZEN
```

Das Skript stoppt nur `demo-web`. Bei Fehlern bleibt sie gestoppt; nicht mit Löschbefehlen an der Datenbank experimentieren. Niemals `docker system prune --volumes` oder Befehle ausführen, die andere Projekte betreffen.

## Stoppen / wieder starten

```bash
sudo docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml stop
sudo docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml up -d
```

Daten bleiben in eigenen Docker-Volumes mit dem Projektpräfix `mobile-reserve-demo-sonnenhain_` erhalten. Keine Ports der Datenbank sind auf dem NAS veröffentlicht. Die lokale Image-Bezeichnung und der Projektname gehören ausschließlich zu dieser Demo; nicht für ein zweites unabhängiges Demo-Paket wiederverwenden.

## Inhalt / Sicherheit / Teststand

6 Schulen, 12 Lehrkräfte, 25 Anfragen vom 14.09. bis 16.10.2026: offen, teilweise und vollständig besetzt. Keine früheren oder stornierten Einsätze. Die Termine bleiben fest und können bei sehr späten Vorführungen irgendwann zurückliegen. Die Demo ist voll bedienbar, kein schreibgeschütztes Schaufenster. Keine echten personenbezogenen Daten eingeben.

Mail und Geräte-Push sind im Demo-Code **und** über eine feste Serverkonfiguration gesperrt. Der automatische Versionshinweis und die Hintergrundbereinigung sind für diese Vorführinstanz deaktiviert. Niemand braucht reale SMTP-Zugänge, echte Signaturen oder die Produktionsdatenbank. Eine Anmeldung am Schulamtskonto gibt volle Verwaltungsrechte nur in dieser Demo.

Der App-Code, Seed, Rollen-Logins, PDF, Versand­sperre und Datenbankvorgänge werden lokal geprüft. Ein echter Docker-/Container-Manager-Probestart ist in der Entwicklungsumgebung mangels Docker nicht möglich; der erste Docker-Build erfolgt auf deinem Homeserver. Container-Datenbank und Build-Abhängigkeiten werden dabei aus dem Internet geladen. Quellcode und AGPL-3.0-Lizenz liegen unter `app/` bei.
