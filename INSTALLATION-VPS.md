# MobileReserve.Digital auf Debian 13 installieren und aktualisieren

Diese Anleitung führt von einem leeren Server bis zur erreichbaren Anwendung
und erklärt anschließend die regelmäßigen Updates.
Sie gilt für **Debian 13, einen VPS mit x86-64-Prozessor und eine neue MobileReserve-Installation**.
Für einen Umzug mit vorhandenen Daten gilt zusätzlich [FULL-BACKUP.md](FULL-BACKUP.md).

Der Aufbau: **Internet → Caddy mit HTTPS → MobileReserve → PostgreSQL**.
Docker betreibt die Anwendung und Datenbank. Caddy nimmt die Browseranfragen entgegen
und kümmert sich um HTTPS-Zertifikate. Node.js und PostgreSQL bringt das App-System mit.
Sie müssen beide nicht zusätzlich auf Debian installieren.

**Einmalige Installation:** Schritte 1 bis 8. **Spätere App-Updates:** Schritt 9.
**Server und Datenbank aktuell halten:** Schritt 10.

**Sie benötigen kein GitHub-Konto und keine Einladung zum Repository.** Das
[Repository](https://github.com/BastiMuensch/mobile-reserve-app), diese Anleitung
und das fertige Docker-Paket sind öffentlich zugänglich. Für diese Installation
ist weder ein Herunterladen des Quellcodes noch `docker login` erforderlich.

## 1. Domain und Serverzugang vorbereiten

Sie benötigen die Server-IP, einen SSH-Zugang mit Administratorrechten und eine eigene
Domain oder Subdomain. In den Beispielen heißt sie `reserve.example.org`:
**Ersetzen Sie diesen Namen überall durch Ihre tatsächliche Domain.**

Beim Domainanbieter einen **A-Eintrag** für die gewählte Adresse auf die öffentliche
IPv4 des VPS setzen. Einen **AAAA-Eintrag** nur verwenden, wenn auch die dort
eingetragene IPv6 diesen Server erreicht. Falsche Einträge verhindern später HTTPS.

Auf Ihrem eigenen Rechner ein Terminal öffnen:

```bash
ssh root@SERVER_IP
```

`ssh` öffnet eine verschlüsselte Verbindung zum Server. `SERVER_IP` ersetzen Sie durch
dessen IP-Adresse. Den angezeigten Host-Fingerabdruck beim ersten Login mit den
Angaben des Anbieters beziehungsweise seiner Serverkonsole abgleichen.
Falls Ihr Anbieter einen anderen Administratornamen vorgibt, diesen statt `root`
verwenden und danach mit `sudo -i` zur Administratorshell wechseln.

**Alle folgenden Terminalbefehle laufen auf dem VPS als root.** Die Beispiele setzen
SSH-Port **22** voraus. Bei einem anderen Port `ssh -p PORT …` verwenden und die
Firewallregel in Schritt 3 entsprechend anpassen. Für den dauerhaften Zugang einen
SSH-Schlüssel verwenden; Zugang über die Anbieter-Konsole als Rettungsweg bereithalten.
Die Befehle der Reihe nach ausführen und bei einer Fehlermeldung die Ursache beheben,
bevor Sie mit dem nächsten Schritt fortfahren.

## 2. Debian aktualisieren

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl gnupg nano ufw unattended-upgrades \
  debian-keyring debian-archive-keyring apt-transport-https
timedatectl set-timezone Europe/Berlin
dpkg-reconfigure -plow unattended-upgrades
```

- `apt update` lädt die Paketlisten; `apt upgrade` installiert verfügbare Updates.
- `apt install` installiert die Hilfsprogramme: Zertifikate für HTTPS, `curl` für
  Downloads, `gnupg` für Paketschlüssel, `nano` als Texteditor und `ufw` als Firewall.
  Die übrigen Pakete unterstützen Paketquellen und automatische Sicherheitsupdates.
- `-y` bestätigt die Paketinstallation automatisch.
- `timedatectl` stellt die Serverzeitzone ein.
- Bei `dpkg-reconfigure` **Ja** wählen, um automatische Debian-Sicherheitsupdates
  einzuschalten. App-Updates und nötige Serverneustarts bleiben Ihre Aufgabe.

Falls ein Neustart erforderlich ist, `reboot` ausführen und anschließend erneut per
SSH anmelden. Bei einem Administratorkonto danach wieder `sudo -i` verwenden.

## 3. Firewall einschalten

Die bestehende SSH-Verbindung offen lassen. **Zuerst den tatsächlich verwendeten
SSH-Port freigeben**, erst danach die Firewall aktivieren:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```

`deny incoming` blockiert unerwünschte eingehende Verbindungen. `allow outgoing`
erlaubt etwa Downloads und Mailversand. `limit 22/tcp` lässt SSH zu und begrenzt
gehäufte Verbindungsversuche. Port **80** wird für HTTP und die Zertifikatsprüfung,
**443** für HTTPS benötigt. `enable` aktiviert die Regeln; die Rückfrage bestätigen.
`status verbose` zeigt die geltenden Regeln. Danach in einem zweiten Terminal einen
neuen SSH-Login testen, bevor Sie die erste Verbindung schließen.
Die Befehle sind im [Debian-Handbuch zu UFW](https://manpages.debian.org/trixie/ufw/ufw.8.en.html) beschrieben.

Hat Ihr VPS-Anbieter eine zusätzliche Firewall, dort ebenfalls SSH sowie TCP 80
und 443 zulassen. **3120 und 5432 werden nicht öffentlich freigegeben.** Die erzeugte
Docker-Konfiguration bindet den App-Zugang nur an `127.0.0.1`, also an den Server
selbst; die Datenbank hat keinen öffentlichen Port. Das ist wichtig, weil
[Docker-Portfreigaben UFW umgehen können](https://docs.docker.com/engine/install/debian/#firewall-limitations).

## 4. Docker installieren

Die folgenden Befehle hinterlegen die
[offizielle Docker-Paketquelle](https://docs.docker.com/engine/install/debian/#install-using-the-apt-repository):

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
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker compose version
docker run --rm hello-world
```

`install -d` legt den Schlüsselordner an. `curl -fsSL` lädt den öffentlichen
Paketschlüssel und meldet Downloadfehler; `-o` bestimmt die Zieldatei. `chmod a+r`
macht den Schlüssel für die Paketverwaltung lesbar. Mit ihm prüft sie signierte
Paketinformationen.

Der Block von `cat` bis `EOF` schreibt die Paketquelle in eine Datei. Die Ausdrücke
`$(…)` ermitteln Debian-Version und Prozessorarchitektur automatisch. Den Block
vollständig einschließlich der abschließenden Zeile `EOF` kopieren.

Die Pakete liefern Docker und `docker compose`, das mehrere zusammengehörige
Container verwaltet. `systemctl enable --now` startet Docker und aktiviert den
Start beim Hochfahren. `docker compose version` muss eine Versionsnummer ausgeben.
`hello-world` prüft mit einem kleinen Testcontainer, ob Download und Containerstart
funktionieren. Erwartet wird die Meldung **„Hello from Docker!“**.

Damit Containerprotokolle die Festplatte nicht unbegrenzt füllen, auf diesem
frischen Docker-System die Protokollrotation einstellen:

```bash
install -d -m 0755 /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker
```

Das begrenzt die Protokolle je Container auf drei Dateien mit jeweils ungefähr
10 MB. `restart` lädt die Einstellung, bevor die App-Container angelegt werden.
Eine bereits vorhandene eigene `daemon.json` ergänzen, statt sie zu überschreiben.
Die Einstellungen sind in der [Docker-Dokumentation zur Protokollrotation](https://docs.docker.com/engine/logging/drivers/local/) beschrieben.

## 5. MobileReserve vorbereiten und starten

Die aktuell veröffentlichte Version ist **0.1.40** (Stand: 27.10.2026;
[Release auf GitHub](https://github.com/BastiMuensch/mobile-reserve-app/releases/tag/v0.1.40),
veröffentlicht am 27.10.2026).
Kopieren Sie diesen vollständigen Block ins SSH-Terminal des VPS. Die Version ist
bereits eingetragen; eine zusätzliche Eingabe ist hier nicht nötig:

```bash
MR_VERSION=0.1.40
MR_IMAGE="ghcr.io/bastimuensch/mobile-reserve-app:${MR_VERSION}"
docker pull "$MR_IMAGE"
```

`MR_VERSION=0.1.40` legt die Version fest. `MR_IMAGE` setzt daraus den vollständigen
Image-Namen zusammen; `${MR_VERSION}` wird automatisch durch `0.1.40` ersetzt.
`docker pull` lädt das App-Paket herunter. Führen Sie die folgenden Schritte in
derselben SSH-Sitzung aus, damit diese Variablen verfügbar bleiben.

Bei einer späteren Installation prüfen Sie die
[veröffentlichten Releases](https://github.com/BastiMuensch/mobile-reserve-app/releases)
und passen die erste Zeile sowie die Versionsangabe im Assistenten gemeinsam an.

**Nur nach erfolgreichem Download fortfahren.** Bei `manifest unknown` die
veröffentlichte Version prüfen. Bei Zugriffsfehlern zuerst den Image-Namen mit
dem obigen Befehl vergleichen; das hier verwendete Paket ist ohne Anmeldung abrufbar.

```bash
install -d -m 0700 /opt/mr-installations
docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,src=/opt/mr-installations,dst=/opt/mr-installations \
  --entrypoint node \
  "$MR_IMAGE" /app/scripts/setup-instance.mjs
```

`0700` erlaubt nur root den Zugriff auf den Installationsordner. `docker run` startet
den Assistenten in einem temporären Container. `-it` ermöglicht seine Eingaben;
`--rm` entfernt anschließend diesen Container. `--mount` macht den angegebenen
Serverordner darin zugänglich, sodass die erzeugten Dateien erhalten bleiben.
`--user` übernimmt für diesen Vorbereitungsschritt Ihre Benutzerrechte, damit
der Assistent in den geschützten Ordner schreiben kann.
`--entrypoint node` startet den Assistenten mit der im Image enthaltenen Node-Laufzeit.

Im Assistenten eingeben:

| Abfrage | Ihre Eingabe |
|---|---|
| Neuer Installationsordner | `/opt/mr-installations/reserve` |
| Öffentliche HTTPS-Adresse | `https://reserve.example.org` mit Ihrer Domain |
| Freier lokaler Gateway-Port | `3120` |
| App-Image | `0.1.40` eingeben und **Enter** drücken, ohne `v`. Die Vorgabe `[latest]` nicht übernehmen. |
| Bestätigung | `NEU` |

Der Assistent schlägt standardmäßig `latest` vor. Erst die Eingabe von `0.1.40`
bindet diese Installation an die hier gewählte Version. `latest` bezeichnet die
jeweils neueste stabile Veröffentlichung und kann bei einem späteren Download
eine andere Version liefern; laufende Container aktualisieren sich nicht automatisch.

Der Unterordner `reserve` darf vorher **noch nicht existieren**. Der Assistent legt
ihn an und erzeugt die Compose-Datei, `.env`, `ZUGANGSDATEN.txt` und `START.md`.
Er erstellt auch alle benötigten technischen Schlüssel und das Push-Schlüsselpaar.
`.env` und `ZUGANGSDATEN.txt` enthalten Geheimnisse: geschützt aufbewahren und nicht
in Chats oder Git übernehmen. Sie sind durch Dateirechte geschützt, nicht verschlüsselt.

Jetzt die Anwendung starten:

```bash
cd /opt/mr-installations/reserve
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps -a
curl -fsS http://127.0.0.1:3120/api/setup/status
```

`cd` wechselt in die Installation. **Alle späteren Compose-Befehle ebenfalls dort
ausführen.** `config --quiet` prüft die Konfiguration ohne Ausgabe der Geheimnisse;
bei einem Fehler zuerst dessen Ursache beheben. `pull` lädt die benötigten Images,
`up -d` startet sie im Hintergrund. Datenbanktabellen werden automatisch eingerichtet.

`ps -a` zeigt den Status: `postgres`, `web` und `recovery` sollen laufen.
`initialize` darf mit **Exited (0)** beendet sein – es erledigt einmalige Vorarbeiten.
Der erste Start kann etwas dauern. Danach muss `curl` eine JSON-Antwort mit
`"needsSetup":true` liefern; `"setupBlocked"` muss `false` sein.
Ist die App noch nicht bereit, kurz warten und den `curl`-Befehl erneut ausführen.
Bleibt der Fehler bestehen, die Protokolle im letzten Abschnitt prüfen.

## 6. Domain mit HTTPS verbinden

Caddy aus seiner [offiziellen Paketquelle](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) installieren:

```bash
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  -o /tmp/caddy-stable.key
gpg --batch --yes --dearmor \
  -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /tmp/caddy-stable.key
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  -o /etc/apt/sources.list.d/caddy-stable.list
chmod a+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
  /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
systemctl enable --now caddy
nano /etc/caddy/Caddyfile
```

Wie bei Docker werden Schlüssel und Paketquelle hinterlegt. `gpg --dearmor`
wandelt den Schlüssel ins benötigte Format um. Danach wird Caddy installiert und
gestartet. `nano` öffnet seine Konfigurationsdatei.

Den mitgelieferten Beispielinhalt durch Folgendes ersetzen und die Domain anpassen:

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

reserve.example.org {
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

    reverse_proxy 127.0.0.1:3120 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

`reverse_proxy` leitet Anfragen an den lokalen Zugang von MobileReserve weiter.
Die `header_up`-Zeilen übergeben die Besucher-IP und das verwendete Protokoll.
`encode` komprimiert Antworten. Die Größenlimits erlauben normale Uploads und die
größeren Vollbackups gezielt auf ihren jeweiligen Pfaden; die Zeitlimits geben
Sicherungen mehr Zeit. Caddy übernimmt die
[Ausstellung und Erneuerung der HTTPS-Zertifikate](https://caddyserver.com/docs/automatic-https).

In nano mit **Strg+O**, **Enter**, **Strg+X** speichern und schließen. Anschließend:

```bash
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy
curl -fsS https://reserve.example.org/api/setup/status
```

`fmt` formatiert die Datei. `validate` prüft sie; durch `&&` wird Caddy nur bei
erfolgreicher Prüfung neu geladen. Der letzte Befehl prüft Domain, HTTPS und App
zusammen. Die Zertifikatsausstellung kann beim ersten Mal kurz dauern.

## 7. Schulamt im Browser einrichten

```bash
cat /opt/mr-installations/reserve/ZUGANGSDATEN.txt
```

`cat` zeigt die vertraulichen Zugangsschlüssel im eigenen Terminal an. Öffnen Sie Ihre
HTTPS-Adresse im Browser und verwenden Sie den **Einrichtungsschlüssel**. Legen Sie das
Schulamt und sein Benutzerkonto mit einem eigenen Passwort an. Es gibt kein
vorgegebenes Standardpasswort. Einrichtungsschlüssel und Notfallschlüssel in einem
Passwortmanager sichern.

Danach die Installation prüfen:

```bash
cd /opt/mr-installations/reserve
docker compose exec -T web node scripts/check-installation.mjs
```

`exec` führt den vorhandenen Installationscheck im laufenden Web-Container aus;
`-T` verzichtet auf ein zusätzliches interaktives Terminal. Er prüft Konfiguration,
Datenbankverbindung und Backup-Werkzeuge, ohne Daten zu verändern oder Schlüssel
auszugeben. Erwartet wird **„Installationscheck bestanden“**.

Für Einladungen und Passwort-Zurücksetzen den Mailversand in den App-Einstellungen
mit den SMTP-Daten Ihres Mailanbieters einrichten und an die eigene Adresse testen.
Ein eigener Mailserver auf dem VPS ist dafür nicht erforderlich.

## 8. Erstes Backup sichern

In **Dokumentation → Sicherung & Wiederherstellung → Vollbackup herunterladen**
ein verschlüsseltes Backup erstellen. Die `.mrbackup`-Datei außerhalb des VPS
speichern und das angezeigte Backup-Passwort getrennt im Passwortmanager verwahren.

Zusätzlich `/opt/mr-installations/reserve` und `/etc/caddy/Caddyfile` verschlüsselt
außerhalb des Servers sichern. Dort liegen die Startkonfiguration und
Betreiber-Zugangsschlüssel. Vor dem Produktivbetrieb regelmäßige externe Sicherungen
und eine Wiederherstellungsprobe in einer getrennten Testinstallation einrichten.
Der Assistent legt keinen automatischen Backup-Zeitplan an. Details zu Umfang und
Wiederherstellung stehen in [FULL-BACKUP.md](FULL-BACKUP.md).

Für den laufenden Betrieb: Debian aktuell halten, freien Speicher kontrollieren
und vor App-Updates ein Backup erstellen. `.env`, technische Schlüssel und den
erzeugten Compose-Projektnamen beibehalten; den Installationsassistenten nur für
neue Instanzen verwenden. **`docker compose down -v` löscht die zugehörigen
Daten-Volumes und gehört nicht zu einem normalen Neustart oder Update.**

## 9. MobileReserve später aktualisieren

Dieser Ablauf gilt für die **mit dieser Anleitung eingerichtete Installation**.
Für ein Update den Einrichtungsassistenten nicht erneut starten. Die vorhandene
`.env`, der darin gespeicherte `COMPOSE_PROJECT_NAME` und alle Schlüssel bleiben erhalten.
Planen Sie eine kurze Unterbrechung und informieren Sie die Nutzer vorab.

### 9.1 Version prüfen und Backup erstellen

Lesen Sie die Hinweise zur gewünschten Version auf der
[Release-Seite](https://github.com/BastiMuensch/mobile-reserve-app/releases).
Falls dort zusätzliche Schritte oder eine geänderte Compose-Konfiguration genannt
sind, diese berücksichtigen. Ein neues App-Image aktualisiert die auf dem Server
gespeicherte Compose-Datei nicht automatisch.

Erstellen Sie wie in Schritt 8 ein frisches **Vollbackup**, laden Sie es herunter
und sichern Sie das zugehörige Passwort. Ab diesem Backup bis zum Abschluss des
Updates sollen keine neuen Einträge mehr vorgenommen werden. Sichern Sie auch die
Startkonfiguration außerhalb des Servers. Als zusätzliche lokale Rückfallkopie:

```bash
cd /opt/mr-installations/reserve
MR_UPDATE_BACKUP="/root/mr-vor-update-$(date +%Y%m%d-%H%M%S)"
install -d -m 0700 "$MR_UPDATE_BACKUP"
cp -a .env docker-compose.yml ZUGANGSDATEN.txt "$MR_UPDATE_BACKUP/"
cp -a /etc/caddy/Caddyfile "$MR_UPDATE_BACKUP/"
docker compose images > "$MR_UPDATE_BACKUP/container-images.txt"
```

Der Ordnername enthält Datum und Uhrzeit. `cp -a` kopiert die Konfiguration mit ihren
Dateirechten; `images` dokumentiert die verwendeten Images. Diese lokale Kopie
enthält Geheimnisse und ersetzt weder das Vollbackup noch dessen externe Ablage.
Die Datenbank und hochgeladenen Dateien liegen in Docker-Volumes, nicht im
Installationsordner.

### 9.2 Gewünschte Version eintragen

```bash
nano /opt/mr-installations/reserve/.env
```

Ändern Sie **nur die Zeile `APP_IMAGE`** auf die gewünschte veröffentlichte Version.
Zum Stand dieser Anleitung lautet sie:

```dotenv
APP_IMAGE=ghcr.io/bastimuensch/mobile-reserve-app:0.1.40
```

Bei einem späteren Update ersetzen Sie `0.1.40` durch die neue Versionsnummer ohne
`v`. Läuft bereits diese Version, ist kein App-Update nötig. Speichern mit
**Strg+O**, **Enter**, **Strg+X**. Insbesondere Datenbankpasswörter und technische
Schlüssel nicht neu erzeugen.

### 9.3 Update herunterladen und starten

```bash
cd /opt/mr-installations/reserve
docker compose config --quiet && \
docker compose pull initialize web recovery && \
docker compose up -d
```

Die drei Befehle prüfen die Konfiguration, laden die neue App-Version und ersetzen
anschließend die betroffenen Container. `&&` bedeutet: Nur weitermachen, wenn der
vorherige Befehl erfolgreich war. Schlägt der Download fehl, wird die laufende
Anwendung durch diesen Block noch nicht ersetzt.

Die App-Dienste `initialize`, `web` und `recovery` verwenden gemeinsam `APP_IMAGE`.
Beim Start führt die App benötigte Datenbankmigrationen automatisch aus. Die
Daten-Volumes bleiben erhalten; ein vorheriges `docker compose down` ist nicht nötig.
`docker compose restart` allein würde das heruntergeladene Image **nicht** übernehmen.
Die [Compose-Dokumentation](https://docs.docker.com/reference/cli/docker/compose/up/)
beschreibt das Ersetzen von Containern bei geänderten Images.

### 9.4 Ergebnis prüfen

```bash
docker compose ps -a
docker compose logs --tail=80 initialize web recovery
docker compose exec -T web node scripts/check-installation.mjs
curl -fsS https://reserve.example.org/api/setup/status
```

Die Domain wieder durch Ihre eigene ersetzen. Warten Sie gegebenenfalls kurz auf
den Start und wiederholen Sie die Prüfung. Erwartet werden laufende Dienste,
`initialize` mit **Exited (0)**, **„Installationscheck bestanden“** und bei einer
bereits eingerichteten Instanz `"needsSetup":false` sowie `"setupBlocked":false`.

Melden Sie sich anschließend im Browser an und prüfen Sie Übersicht, vorhandene
Daten und gegebenenfalls den Mailversand. Erst dann die Anwendung wieder zur Nutzung
freigeben. Bewahren Sie das Backup vor dem Update zunächst auf und erstellen Sie
zusätzlich ein neues Backup des erfolgreich aktualisierten Stands.

### Falls ein Update fehlschlägt

Zuerst Status und Protokolle prüfen. Falls bei einer bestehenden Installation
plötzlich die Ersteinrichtung erscheint, **kein neues Schulamt anlegen**: Prüfen,
ob Sie im richtigen Ordner arbeiten und der bisherige Compose-Projektname erhalten
ist. Nicht mit neuen Schlüsseln oder leeren Volumes weiterarbeiten.

Ein älteres Image allein ist kein zuverlässiger Rückweg, weil ein Update bereits
die Datenbank verändert haben kann. Für die Rückkehr zu einem gesicherten Stand
das Vollbackup mit einem Image derselben **Version und desselben Commits** wie im
Backup wiederherstellen. Der Ablauf steht in [FULL-BACKUP.md](FULL-BACKUP.md).
Bei dieser Installation erreichen Sie die Wiederherstellung unter
`https://reserve.example.org/_recovery/`. Eine Wiederherstellung setzt die Daten auf
den Backup-Zeitpunkt zurück; spätere Änderungen fehlen danach.

## 10. Debian, Docker und Datenbank aktuell halten

### Betriebssystem und Serverprogramme

Prüfen Sie regelmäßig, beispielsweise monatlich, verfügbare Updates; wichtige
Sicherheitsupdates zeitnah einspielen. Vor geplanten Wartungsarbeiten ein aktuelles
Backup erstellen. Auf dem Server als root:

```bash
apt update
apt list --upgradable
apt upgrade
```

`apt list --upgradable` zeigt die verfügbaren Aktualisierungen. `apt upgrade`
installiert sie nach Ihrer Bestätigung. Über die eingerichteten Paketquellen werden
damit auch Docker und Caddy aktualisiert. Dienstneustarts können die Erreichbarkeit
kurz unterbrechen. Die automatischen Debian-Sicherheitsupdates aus Schritt 2 ersetzen
diese regelmäßige Kontrolle nicht und aktualisieren keine App- oder Datenbank-Images.

Nach einem Kernelupdate oder wenn ein Neustart verlangt wird:

```bash
reboot
```

Die SSH-Verbindung wird dabei getrennt. Anschließend neu anmelden, gegebenenfalls
`sudo -i` ausführen und prüfen:

```bash
systemctl is-active docker caddy
ufw status
cd /opt/mr-installations/reserve
docker compose ps -a
docker compose exec -T web node scripts/check-installation.mjs
```

Docker, Caddy und die dauerhaften App-Dienste starten durch ihre Autostart-
Einstellungen wieder. Prüfen Sie zusätzlich die Anmeldung im Browser.

### PostgreSQL innerhalb der Version 16 aktualisieren

PostgreSQL läuft im Container und erhält seine Updates deshalb separat. Nach einem
frischen Backup und im Wartungsfenster:

```bash
cd /opt/mr-installations/reserve
docker compose pull postgres && \
docker compose stop web recovery && \
docker compose up -d
```

Das lädt den aktuellen Stand von `postgres:16-alpine`, pausiert den App-Zugriff und
startet die Dienste mit dem aktualisierten Datenbank-Image. Danach wie in Schritt
9.4 prüfen. **Die Hauptversion `16` beibehalten**: Ein Wechsel auf 17 oder höher ist
eine eigene Datenbankmigration und wird von dieser Anleitung nicht abgedeckt.

### Speicherplatz im Blick behalten

```bash
df -h /
docker system df
```

`df` zeigt den freien Platz auf der Systempartition; `docker system df` den
Docker-Speicherverbrauch. Volumes nicht pauschal bereinigen. Insbesondere
**`docker compose down -v` löscht die Daten dieser Installation**. Alte Images erst
entfernen, wenn sie nicht mehr für eine Wiederherstellung benötigt werden.

## Wenn etwas nicht funktioniert

```bash
cd /opt/mr-installations/reserve
docker compose logs --tail=80 initialize web recovery postgres
journalctl -u caddy -n 80 --no-pager
```

Der erste Befehl zeigt die letzten Container-Meldungen, der zweite die Meldungen
von Caddy. Bei **502** zuerst App-Status und lokalen Aufruf aus Schritt 5 prüfen.
Bei **HTTPS-Fehlern** A-/AAAA-Einträge sowie Port 80/443 in beiden Firewalls prüfen.
Bei Installationsfehlern Protokolle lesen, statt neue Schlüssel zu erzeugen oder
Daten-Volumes zu löschen. Protokolle vor einer Weitergabe auf vertrauliche Inhalte prüfen.

Stand: 27.10.2026. App-Version 0.1.40.
