# Netcup-Rollout – kompakter Ablauf

Stand: 17.09.2026. Geprüft: MobileReserve 0.1.10, Commit `1de564c`, und der lokale Stand von Fortbildung-UAMM einschließlich offener Änderungen. Plan und Befehle wurden nicht auf einem VPS ausgeführt. Veröffentlichung und CI-Erfolg des gewählten Images vor dem Start prüfen.

| Anwendung | Domain | Ziel für Caddy auf dem Host |
|---|---|---|
| MobileReserve | `uamm.mobilereserve.digital` | Recovery-Gateway auf `127.0.0.1:3000` |
| Fortbildung-UAMM | `fortbildung.bdb-uamm.de` | `127.0.0.1:3001` |
| Eigenständige Schulamtswebsite | `schulamt.bdb-uamm.de` | HTML unter `/srv/www/schulamt` oder WordPress auf `127.0.0.1:8080` |

Die MobileReserve-Landingpage gehört nicht zur Schulamtswebsite. HTML oder WordPress ist noch offen. Dieser Plan betrifft einen neuen Debian-13-VPS (Trixie).

## 1. Releases und Datenübernahme vorbereiten

- **MobileReserve:** Node 24 ist bereits umgesetzt. Für den neuen VPS den Installationsassistenten und `docker-compose.managed.yml` verwenden. Keine manuelle Schlüsselerzeugung und keine zusätzliche klassische Compose-Datei mehr.
- **Fortbildung:** Der aktuelle Dockerfile enthält weiterhin weder `src/lib/schlagwort.ts` (vom Seed benötigt) noch `src/lib/fibs/fixtures/` (vom Testimport benötigt). Vor `USER nextjs` diese beiden Zeilen ergänzen, dann Image bauen und Seed/Testimport prüfen:

  ```dockerfile
  COPY --from=builder /app/src/lib/schlagwort.ts ./src/lib/schlagwort.ts
  COPY --from=builder /app/src/lib/fibs/fixtures ./src/lib/fibs/fixtures
  ```

  Für den VPS die einzige Portzuordnung in der Produktionsdatei auf `127.0.0.1:3001:3000` ändern. Lokale, noch nicht eingecheckte Formularänderungen sind nicht automatisch im veröffentlichten Image. Den tatsächlich freigegebenen Stand festlegen.
- **Bestehende Daten:** MobileReserve über verschlüsseltes `.mrbackup` übernehmen; das Ziel muss exakt dieselbe App-Version und denselben Commit wie das Backup haben. Ein Backup aus 0.1.9 nicht direkt in 0.1.10 einspielen. Erst kontrolliert die Quelle aktualisieren und neu sichern oder mit der zum Backup passenden Zielversion wiederherstellen. Fortbildung separat über PostgreSQL-Dump übernehmen. Bei einer Neuinstallation ohne Bestandsdaten entfällt der Import.

## 2. DNS, Debian und SSH

Für alle drei Domains A-Einträge auf die VPS-IPv4 setzen. AAAA nur bei funktionierendem IPv6. Falls bereits Websites bestehen, DNS erst nach erfolgreicher Migrationsprobe umstellen; TLS und Ziel vorab über einen geeigneten Testzugang prüfen.

SSH-Schlüsselzugang und `sudo` testen, bevor Root- und Passwort-Login deaktiviert werden. Netcup-Konsole als Rettungszugang bereithalten. Folgende Serverbefehle als root, nach Login als Administrator mit `sudo -i`:

```bash
cat /etc/os-release
apt update
apt full-upgrade -y
apt install -y ca-certificates curl gnupg nano ufw openssl rsync \
  debian-keyring debian-archive-keyring apt-transport-https \
  unattended-upgrades
timedatectl set-timezone Europe/Berlin
dpkg-reconfigure -plow unattended-upgrades
```

Bei automatischen Sicherheitsupdates „Ja“ wählen; notwendige Neustarts einplanen.

## 3. UFW aktivieren

SSH-Standardport 22 vorausgesetzt. Bestehende SSH-Verbindung offen lassen und nach Aktivierung einen zweiten Login testen.

```bash
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable
ufw status verbose
```

Keine Freigaben für App- oder Datenbankports. Docker-Portfreigaben können UFW umgehen: nur Loopback veröffentlichen, Datenbanken ohne Host-Port betreiben. Zusätzliche Netcup-SCP-Regeln dürfen HTTP/HTTPS, SSH, benötigten Rückverkehr und ausgehenden SMTP-Verkehr zum Mailanbieter nicht blockieren.

## 4. Docker und Caddy installieren

### Docker mit Compose

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt update
apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
```

Nur auf dem neuen Docker-System die Logkonfiguration anlegen; eine vorhandene `daemon.json` nicht überschreiben:

```bash
install -d -m 0755 /etc/docker
test ! -e /etc/docker/daemon.json && cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker
docker run --rm hello-world
docker compose version
```

### Caddy

```bash
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  -o /tmp/caddy-stable.key
gpg --batch --yes --dearmor \
  -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
  /tmp/caddy-stable.key
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  -o /etc/apt/sources.list.d/caddy-stable.list
chmod a+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
  /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
systemctl enable --now caddy
```

Offizielle Quellen: [Docker für Debian](https://docs.docker.com/engine/install/debian/), [Caddy installieren](https://caddyserver.com/docs/install), [UFW](https://manpages.debian.org/trixie/ufw/ufw.8.en.html).

## 5. MobileReserve mit dem neuen Assistenten vorbereiten

Beispiel für eine neue Installation mit veröffentlichtem, erfolgreich geprüftem Image 0.1.10. Der Assistent ist ab diesem Image enthalten; die Registry-Verfügbarkeit wurde hier nicht bestätigt. Bei privatem Paket vorher `docker login ghcr.io -u BastiMuensch` ausführen.

Nur einen eigenen Elternordner anlegen. Der Zielordner `uamm` darf noch nicht existieren, auch nicht leer:

```bash
install -d -m 0700 /opt/mr-installations
docker pull ghcr.io/bastimuensch/mobile-reserve-app:0.1.10

docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,src=/opt/mr-installations,dst=/opt/mr-installations \
  --entrypoint node \
  ghcr.io/bastimuensch/mobile-reserve-app:0.1.10 \
  /app/scripts/setup-instance.mjs
```

Im Assistenten eingeben:

| Abfrage | Wert |
|---|---|
| Neuer Installationsordner | `/opt/mr-installations/uamm` |
| Öffentliche HTTPS-Adresse | `https://uamm.mobilereserve.digital` |
| Gateway-Port | **`3000` ausdrücklich eingeben** (Assistent-Vorgabe ist 3120) |
| App-Release | `0.1.10`, bei Migration exakt die Backup-Version |
| Bestätigung | `NEU` |

Der Assistent erzeugt `.env`, Compose-Datei, `ZUGANGSDATEN.txt` und `START.md`. Er startet noch nichts. Kein Node.js auf dem Host und kein Docker-Socket-Mount erforderlich.

Anschließend die erzeugten Befehle aus `START.md` verwenden. Im neuen Ordner entsprechen sie grundsätzlich:

```bash
cd /opt/mr-installations/uamm
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

Den erzeugten `COMPOSE_PROJECT_NAME` und die Schlüssel dauerhaft beibehalten. Keine alten Overrides hinzufügen, keine vorhandenen PostgreSQL-Volumes zuweisen und bei Updates den Assistenten nicht erneut ausführen. Ein beendeter Initialisierungsdienst mit Exitcode 0 ist in diesem Stack erwartbar.

## 6. Fortbildung und Schulamtswebsite bereitstellen

**Fortbildung:** Eigener Stack unter `/opt/fortbildung`, PostgreSQL 16 mit eigenem Passwort, korrigiertes und geprüftes Image festlegen. Für die VPS-Konfiguration:

```dotenv
APP_BASE_URL=https://fortbildung.bdb-uamm.de
SESSION_COOKIE_SECURE=true
FIBS_IMPORT_ENABLED=false
RETENTION_SCHEDULER=on
```

`APP_IMAGE`, `JWT_SECRET` und `POSTGRES_PASSWORD` zusätzlich unabhängig setzen. Die App-Portzuordnung lautet ausschließlich `127.0.0.1:3001:3000`. Start nach Erstellung der Produktionskonfiguration:

```bash
cd /opt/fortbildung
docker compose config --quiet
docker compose pull
docker compose up -d --no-build
```

Bei neuer Datenbank den dokumentierten Admin-/Stammdaten-Seed ausführen; bei Datenübernahme erst den Dump in eine leere Datenbank einspielen und vorhandene Konten verwenden. Keine Seed-Zugangsdaten als Standardpasswort übernehmen. Detaillierter Projektablauf: [Fortbildung-README](../fortbildungen-uamm/README.md).

**Schulamtswebsite:** Eigene Inhalte, keine MobileReserve-Landingpage. HTML-Dateien unter `/srv/www/schulamt` bereitstellen, Verzeichnisse 0755 und Dateien 0644. Falls WordPress gewählt wird, einen eigenen Stack samt MariaDB auf Loopback-Port 8080 einrichten. Bis zur Auswahl und Einrichtung liefert Caddy unten eine Wartungsmeldung.

## 7. Caddy mit Backup-Unterstützung konfigurieren

Die alte pauschale 12-MiB-Grenze würde die neue Browser-Wiederherstellung blockieren. Nur `/_recovery/api/upload` erhält 193 MiB. Die normalen Upload-Limits bleiben erhalten. Der öffentliche Port 3000 gehört jetzt dem Gateway, nicht direkt `web`.

Folgende Konfiguration nach Sicherung einer bestehenden Datei in `/etc/caddy/Caddyfile` eintragen. Globale Zeitlimits gelten für die gemeinsam verwendeten Listener; längere Uploads und Backup-Exporte erhalten ausreichend Zeit.

```caddyfile
{
    servers {
        timeouts {
            read_header 10s
            read_body 300s
            write 600s
        }
    }
}

uamm.mobilereserve.digital {
    encode zstd gzip

    @recoveryUpload path /_recovery/api/upload
    request_body @recoveryUpload {
        max_size 193MiB
    }

    @upload path /api/upload
    request_body @upload {
        max_size 6MiB
    }

    @other {
        not path /_recovery/api/upload /api/upload
    }
    request_body @other {
        max_size 12MiB
    }

    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        transport http {
            response_header_timeout 300s
            read_timeout 300s
            write_timeout 300s
        }
    }
}

fortbildung.bdb-uamm.de {
    encode zstd gzip
    request_body {
        max_size 2MiB
    }
    reverse_proxy 127.0.0.1:3001 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

schulamt.bdb-uamm.de {
    respond "Die Schulamtswebsite wird vorbereitet." 503
}
```

Solange Fortbildung noch nicht läuft, auch dort eine Wartungsantwort statt `reverse_proxy` verwenden. Für die fertige HTML-Website den Schulamtsblock ersetzen durch:

```caddyfile
schulamt.bdb-uamm.de {
    encode zstd gzip
    root * /srv/www/schulamt
    file_server
}
```

Bei WordPress dort stattdessen `reverse_proxy 127.0.0.1:8080` verwenden, nachdem dessen gesicherte Ersteinrichtung abgeschlossen wurde.

```bash
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
  && systemctl reload caddy
```

Dokumentation: [Caddy-Limits](https://caddyserver.com/docs/caddyfile/directives/request_body), [Proxy-Zeitlimits](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Server-Zeitlimits](https://caddyserver.com/docs/caddyfile/options).

## 8. Einrichtung, Migration und Abnahme

**Neue MobileReserve-Instanz:** Domain öffnen, Einrichtungsschlüssel aus `ZUGANGSDATEN.txt` verwenden und Schulamt einrichten.

**MobileReserve-Umzug:** Auf der Quelle ein Wartungsfenster herstellen, Hintergrundversand pausieren und weitere Benutzerschreibzugriffe verhindern. Letztes Vollbackup exportieren, Passwort getrennt sichern und alte App stoppen. Auf dem passend versionierten neuen Gateway `https://uamm.mobilereserve.digital/_recovery/` öffnen. Auf leerer Instanz mit Einrichtungsschlüssel anmelden und das eigene Vollbackup importieren. Danach frisch anmelden, Daten/Dateien und Mail-Outbox kontrollieren; Benachrichtigungen erst ausdrücklich im Portal fortsetzen. Nur eine Instanz darf senden. Details: [FULL-BACKUP.md](FULL-BACKUP.md).

Lesenden Check nach Start/Einrichtung beziehungsweise nach abgeschlossener Wiederherstellung ausführen:

```bash
cd /opt/mr-installations/uamm
docker compose exec -T web node scripts/check-installation.mjs
curl -fsS https://uamm.mobilereserve.digital/api/setup/status
curl -fsS https://fortbildung.bdb-uamm.de/api/ics
```

Die neue Prüfung kennt die aktive Recovery-Generation. Eine noch pausierte oder ungültige Generation wird nicht als betriebsbereit gemeldet. Zusätzlich Rollen-Logins, Speichern, PDF, Upload, Mail und Wiederanlauf nach Serverneustart testen.

**Backupplan ändern:** Das früher vorgeschlagene MobileReserve-Shellskript nicht für diesen Managed-Stack übernehmen. Es würde die ursprünglichen Datenbank-/Uploadpfade sichern, statt nach einer Wiederherstellung zuverlässig die aktive Generation. `.mrbackup` berücksichtigt die aktive App-Konfiguration und Dateien. Es ist aber ein manueller Export und kein täglicher Sicherungsdienst.

Vor dem offiziellen Start einen automatischen externen Sicherungsablauf für den Managed-Stack festlegen und testen: PostgreSQL-Cluster einschließlich Rollen und Generationen, Upload-Volumes sowie `recovery-state`, `recovery-runtime` und `recovery-data` zusammengehörig sichern. `.env`, `ZUGANGSDATEN.txt`, Compose-Datei, Image-Stand und Caddy-Konfiguration separat einschließen. Rohkopien laufender Datenbank-Volumes sind kein konsistentes Backup; einen koordinierten Offline-Snapshot oder einen passend entworfenen Datenbank-/Dateibackupablauf verwenden.

Fortbildung weiterhin separat als PostgreSQL-Dump plus Konfiguration sichern. Schulamtswebsite: HTML-Dateien oder WordPress-Datenbank und Dateien. Sicherungen verschlüsselt außerhalb des VPS aufbewahren, Aufbewahrungsfrist und Fehleralarmierung festlegen und Wiederherstellung auf getrennter Testinstanz prüfen.

**Freigabestand:** 14 gezielte Tests für MobileReserve-Installationsassistent und Installationscheck lokal bestanden. Docker-Gesamttest, Registry-/CI-Status, Caddy-Validierung auf dem VPS, reale Migration und Wiederherstellungsprobe sind damit nicht nachgewiesen. Fortbildungs-Imagekorrekturen, Auswahl der Schulamtswebsite und automatisches externes Backup bleiben vor dem vollständigen Rollout offen.
