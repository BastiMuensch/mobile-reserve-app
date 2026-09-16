# Das ultimative Deployment & Sicherheits-Handbuch

Für **neue getrennte Installationen** gibt es einen interaktiven Assistenten, der
technische Schlüssel einmalig erzeugt und die öffentliche Adresse abfragt:
[INSTALLATION.md](INSTALLATION.md). Bestehende Installationen werden nicht überschrieben.

## Vollbackup und Serverumzug

Für die vollständige Sicherung einschließlich Benutzerpasswörtern (Hashes),
SMTP-Zugang, technischen Schlüsseln und Upload-Dateien gilt die separate Anleitung
[FULL-BACKUP.md](FULL-BACKUP.md). Der neue verschlüsselte Download ersetzt den bisherigen
JSON-Export. Alte JSON-Dateien bleiben importierbar, sind aber keine vollständigen
Umzugssicherungen. Infrastruktur wie Pangolin/DNS und eigene Host-Konfigurationen
werden unabhängig von der App gesichert.

Diese Anleitung beschreibt, wie du die Mobile Reserve App auf einem **frischen Debian-Server** absolut sicher und professionell für den Produktivbetrieb (inklusive Firewall und SSL/HTTPS) einrichtest. Im zweiten Teil erfährst du, wie du ein **bestehendes System** updatest.

---

## Warum Debian?
Debian gilt in der Serverwelt als der absolute **"Fels in der Brandung"**. Es ist die ideale Linux-Variante für dieses Projekt, weil:
1. **Extreme Stabilität:** Im Gegensatz zu Ubuntu oder anderen Distributionen installiert Debian keine unnötige "Bloatware". Was läuft, das läuft.
2. **Langzeit-Support (LTS):** Du bekommst jahrelang verlässliche Sicherheitsupdates, ohne das gesamte Betriebssystem neu aufsetzen zu müssen.
3. **Maximale Sicherheit:** Debian ist extrem konservativ, was Software-Updates angeht. Es werden nur Updates ausgeliefert, die jahrelang auf Herz und Nieren geprüft wurden. Dadurch stürzt dein Server nach einem Update nicht überraschend ab.

---

## Teil 1: Neuinstallation (Debian)

Voraussetzung: Du bist via SSH als `root` (oder Nutzer mit `sudo`-Rechten) auf dem Server eingeloggt. Stelle außerdem sicher, dass deine Wunsch-Domain (z.B. `app.schulamt.de`) bereits auf die IP-Adresse deines Servers zeigt!

### Schritt 1: Firewall (UFW) einrichten
Bevor wir Software installieren, schließen wir den Server sicherheitshalber ab und lassen nur die Türen offen, die wir wirklich brauchen.
```bash
sudo apt-get update
# Installiere die Firewall (ufw) und den Texteditor (nano)
sudo apt-get install -y ufw nano

# 1. Wir verbieten standardmäßig alle eingehenden Verbindungen (Sicherheit!)
sudo ufw default deny incoming

# 2. Wir erlauben ausgehende Verbindungen (z.B. für Updates)
sudo ufw default allow outgoing

# 3. Wir öffnen den Port für SSH (Port 22), damit wir uns nicht selbst aussperren!
sudo ufw allow ssh

# 4. Wir öffnen HTTP (Port 80) und HTTPS (Port 443) für die Web-App
sudo ufw allow http
sudo ufw allow https

# 5. Firewall aktivieren
sudo ufw enable
```
*Was passiert hier?* UFW ("Uncomplicated Firewall") ist ein sehr leicht bedienbares Tool, um den Server vor Hackern abzuschirmen. Jemand, der versucht, auf andere interne Ports (wie unsere Datenbank) zuzugreifen, prallt an dieser virtuellen Wand ab.

### Schritt 2: Docker installieren
Docker ist die "Laufzeitumgebung", in der unsere App samt Datenbank isoliert läuft.
```bash
# Nötige Hilfsprogramme für den Download installieren
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# Den offiziellen Sicherheitsschlüssel (GPG-Key) von Docker herunterladen, 
# damit wir sicher sind, dass wir das Original-Docker installieren.
sudo mkdir -m 0755 -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Docker als sichere Download-Quelle im System eintragen
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker Pakete herunterladen und installieren
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### Schritt 3: NGINX und Certbot installieren (SSL/HTTPS)
Damit deine App als installierbare PWA funktioniert und Passwörter sicher übertragen werden, brauchen wir HTTPS. Nginx arbeitet dabei als "Türsteher" (Reverse Proxy), nimmt Anfragen aus dem Internet an, verschlüsselt sie und reicht sie intern an Docker weiter.
```bash
# NGINX (Webserver) und Certbot (kostenlose SSL-Zertifikate) installieren
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Lösche die Standard-Seite von NGINX
sudo rm /etc/nginx/sites-enabled/default

# Erstelle eine Konfigurationsdatei für unsere App (ersetze nano mit deinem Editor, falls bevorzugt)
sudo nano /etc/nginx/sites-available/mobile-reserve
```

Kopiere den folgenden Text in die Datei und ersetze `DEINE_DOMAIN_HIER` durch deine echte Domain (z.B. `app.schulamt.de`):
```nginx
server {
    listen 80;
    server_name DEINE_DOMAIN_HIER;

    # Logo und Unterschrift werden während der Ersteinrichtung gemeinsam übertragen.
    client_max_body_size 12m;

    # Der reguläre Einzeldatei-Upload ist auf 5 MB begrenzt. Dieses Limit ist
    # zusätzlich zur API-Prüfung nötig, weil Next Route Handlers Multipartdaten
    # beim Aufruf von request.formData() im Speicher puffern.
    location = /api/upload {
        client_max_body_size 6m;
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        # Leitet alle Anfragen an unseren Docker-Container auf Port 3000 weiter
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        # Eingehende Client-Header bewusst überschreiben, damit API-Ratenlimits
        # nicht durch ein gefälschtes X-Forwarded-For umgangen werden können.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Datei speichern (`Strg+O`, `Enter`) und schließen (`Strg+X`).

```bash
# Die neue Nginx-Konfiguration aktivieren
sudo ln -s /etc/nginx/sites-available/mobile-reserve /etc/nginx/sites-enabled/

# Nginx neustarten, um die Änderungen zu übernehmen
sudo systemctl restart nginx

# SSL-Zertifikat automatisch anfordern und einrichten
sudo certbot --nginx -d DEINE_DOMAIN_HIER
```
*Was passiert hier?* Certbot redet im Hintergrund mit der Organisation "Let's Encrypt". Es beweist, dass dir die Domain gehört, lädt ein Zertifikat herunter und ändert die NGINX-Datei automatisch so um, dass ab sofort alles sicher über HTTPS läuft. Das Zertifikat wird künftig von selbst im Hintergrund erneuert!

### Schritt 4: App-Ordner vorbereiten und App starten
```bash
# Verzeichnis erstellen und dorthin wechseln
sudo mkdir -p /opt/mobile-reserve
cd /opt/mobile-reserve

# Lade die Produktions-Compose-Datei und die .env.example herunter
sudo curl -o docker-compose.yml https://raw.githubusercontent.com/BastiMuensch/mobile-reserve-app/main/docker-compose.prod.yml
sudo curl -o .env https://raw.githubusercontent.com/BastiMuensch/mobile-reserve-app/main/.env.example

# Datei bearbeiten
sudo nano .env
```
Setze mindestens `POSTGRES_PASSWORD`, `JWT_SECRET`, `SETUP_TOKEN`,
`SMTP_ENCRYPTION_KEY`, `INVITATION_TOKEN_PEPPER` und `NEXT_PUBLIC_APP_URL`.
Geeignete Werte lassen sich beispielsweise so erzeugen:

```bash
openssl rand -hex 32       # JWT_SECRET, SETUP_TOKEN, INVITATION_TOKEN_PEPPER
openssl rand -base64 32    # SMTP_ENCRYPTION_KEY (genau 32 Byte, Base64-kodiert)
```

`SETUP_TOKEN` schützt ausschließlich die noch nicht abgeschlossene Ersteinrichtung.
Der SMTP-Schlüssel darf nach der Einrichtung nicht verloren gehen, weil gespeicherte
Mail-Zugangsdaten sonst nicht mehr entschlüsselt werden können.

```bash
# Docker lädt die Datenbank und das fertige App-Image herunter und startet beides im Hintergrund (-d)
sudo docker compose up -d
```

Rufe danach die konfigurierte HTTPS-Adresse auf. Bei einer leeren Datenbank erscheint
die Ersteinrichtung. Dort werden `SETUP_TOKEN`, Schulamtszugang, Briefkopf, Logo,
Unterschrift, mindestens eine Schule und optional der SMTP-Zugang abgefragt. Erst nach
der PDF-Vorschau wird die Einrichtung atomar abgeschlossen; ein technischer
Standard-Admin und regionale Beispieldaten werden nicht angelegt.

> [!TIP]
> **Für zukünftige App-Updates auf diesem Server reicht:**
> `cd /opt/mobile-reserve && sudo docker compose pull && sudo docker compose up -d`

### Hinweise auf neue Versionen

Angemeldete Schulamtsleitungen sehen im Dashboard einen Hinweis, sobald eine neue
stabile GitHub-Version veröffentlicht wurde. Unter **Einstellungen → Software-Updates**
stehen Versionsnummer, Veröffentlichungsdatum, Änderungen und der kopierbare
Terminalbefehl. Das geöffnete Dashboard fragt stündlich nach; der Server kontaktiert GitHub
dabei höchstens einmal täglich und nach einem App-Neustart beim nächsten Dashboard-Aufruf.
Die App installiert nichts selbst.
Die Aktualisierung bleibt bewusst Aufgabe der Serverbetreuung.

Der Check überträgt keine Daten des Schulamts. Er kann bei Installationen ohne
ausgehenden Internetzugang in `.env` abgeschaltet werden:

```env
UPDATE_CHECK_ENABLED=false
```

Bei einem nicht erreichbaren GitHub-Dienst läuft die App unverändert weiter. Der letzte
erfolgreich ermittelte Stand bleibt sichtbar und wird als möglicherweise veraltet markiert.

### Karten und Geocoding

Die sichtbare Hintergrundkarte wird ohne API-Schlüssel vom bayerischen LDBV geladen.
Für die Standortsuche nutzt der Server standardmäßig OpenStreetMap Nominatim. Bei
Lehrkräften wird ausschließlich die fünfstellige PLZ übertragen; Name und vollständige
Privatanschrift verlassen die Installation nicht. Die PLZ liefert nur einen Startpunkt.
Die Lehrkraft setzt und bestätigt den endgültigen Pin selbst. Das Schulamt sieht diesen
bestätigten Pin und die Entfernungsmessung verwendet seine Koordinaten.

Um die Nutzungsregeln des öffentlichen Dienstes einzuhalten, begrenzt die App alle
Nominatim-Aufrufe zentral auf weniger als eine Anfrage pro Sekunde und speichert
PLZ-Ergebnisse dauerhaft zwischen. In `.env` sollte eine erreichbare Kontaktadresse im
User-Agent hinterlegt werden:

```env
GEOCODING_BASE_URL=https://nominatim.openstreetmap.org
GEOCODING_USER_AGENT=MobileReserve.digital/1.0 (kontakt@ihre-domain.de)
```

`GEOCODING_BASE_URL` kann später auf eine selbst betriebene, Nominatim-kompatible Instanz
umgestellt werden, ohne die Formulare zu ändern.

### Veröffentlichung einer neuen Version

Update-Hinweise orientieren sich ausschließlich an veröffentlichten GitHub-Releases mit
semantischen Tags wie `v1.2.0`. Normale Commits auf `main` erzeugen weiterhin ein
Entwicklungsimage, überschreiben aber nicht mehr das stabile Docker-Tag `latest`.
Beim Veröffentlichen eines stabilen Releases erstellt der Workflow aus demselben Commit
das versionierte Image und aktualisiert `latest`. Vorabversionen erhalten nie das produktive
`latest`-Tag. Ungültig benannte Releases werden vor dem Image-Build abgebrochen. Die
Beschreibung des GitHub-Releases wird als Änderungsinformation in der App angezeigt.

---

## Teil 2: Bestehendes System anpassen

Du hast die App aktuell bereits lokal (ohne HTTPS/Nginx) am Laufen und willst auf die Build-freie Architektur wechseln.

### Schritt 1: Laufendes System stoppen
```bash
# Ins Verzeichnis der App wechseln
cd /pfad/zu/deinem/mobile-reserve-app

# Alten Container stoppen
docker compose down
```
Deine alte PostgreSQL-Datenbank liegt sicher im Docker-Volume (`postgres-data`) und geht nicht verloren!

### Schritt 2: Neue Dateien verwenden
**Wenn dein GitHub Repository öffentlich (Public) ist:**
Lade dir die aktuelle Produktions-Version herunter:
```bash
curl -o docker-compose.yml https://raw.githubusercontent.com/BastiMuensch/mobile-reserve-app/main/docker-compose.prod.yml
```

**Wenn dein GitHub Repository privat (Private) ist:**
Bei einem privaten Repository funktioniert der Download-Befehl nicht. Du musst stattdessen:
1. Dein Docker-Image (Paket) auf GitHub unter "Packages" -> "Package settings" -> "Change visibility" auf **Public** stellen.
2. Auf dem Server die Datei manuell bearbeiten: `nano docker-compose.yml`
3. Den alten Inhalt löschen und den Inhalt deiner `docker-compose.prod.yml` manuell hineinkopieren.

### Schritt 3: .env aktualisieren
Öffne deine bestehende `.env` Datei (`nano .env`) und ergänze mindestens folgende Werte,
falls sie fehlen:
```env
CRON_SECRET=dein_sicheres_cron_passwort
NEXT_PUBLIC_APP_URL=https://app.deine-domain.de
SETUP_TOKEN=ein_langer_zufaelliger_setup_token
SMTP_ENCRYPTION_KEY=base64_kodierter_32_byte_schluessel
INVITATION_TOKEN_PEPPER=ein_separater_langer_zufaelliger_schluessel
```
`NEXT_PUBLIC_APP_URL` ist **Pflicht**: Aus diesem Wert werden die Links in den Passwort-Reset-E-Mails
gebaut. Fehlt er, verschickt die App bewusst keine Reset-Links mehr – denn eine aus den
Request-Headern abgeleitete Adresse liesse sich faelschen und der Reset-Token waere angreifbar.
*(Hinweis: Denke dir hier eine lange, zufällige Zeichenkette aus – genau wie beim `JWT_SECRET`. Ohne diesen Wert verweigert die nächtliche DSGVO-Bereinigung bewusst den Dienst; siehe Teil 3.)*

### Schritt 4: Neu starten
Starte das System nun mit der neuen Konfiguration:
```bash
docker compose up -d
```
Ab sofort zieht Docker beim Start das fertig gebaute Image (`ghcr.io/bastimuensch/...`), anstatt es jedes Mal mühsam lokal mit `build: .` zu kompilieren. Die bestehende Datenbank wird nahtlos weiterverwendet.

---

## Teil 3: Automatische DSGVO-Bereinigung

Damit die App datenschutzkonform bleibt, anonymisiert und löscht sie regelmäßig alte Daten.

**Dafür musst du nichts einrichten.** Die App bringt ihren Zeitplan selbst mit: Beim Start des Containers meldet sich im Log

```
[DSGVO-CLEANUP] Scheduler aktiv (stündliche Prüfung, Lauf einmal täglich).
```

Ab da prüft die App stündlich, ob die Bereinigung fällig ist, und führt sie einmal täglich aus – bevorzugt nachts zwischen 01:00 und 05:00 Uhr, damit die Löschvorgänge nicht in die Arbeitszeit fallen. Lief sie länger als 36 Stunden nicht (z.B. weil der Server nachts aus war), holt sie den Lauf unabhängig von der Uhrzeit nach. Ein früher nötiger `crontab`-Eintrag entfällt – auch bei zukünftigen Deployments.

> [!NOTE]
> Der Zeitplan lebt im laufenden Container. Auf einem durchlaufenden Server – wie hier beschrieben – ist das genau richtig. Würdest du die App später auf eine Plattform umziehen, die Container bei Inaktivität schlafen legt, wäre der externe Cronjob (siehe unten) wieder die verlässlichere Variante.

### Welche Fristen gelten?

| Frist | Was passiert | Betrifft |
|---|---|---|
| **30 Tage** | Klarnamen werden durch `*** gelöscht (DSGVO) ***` ersetzt | `Request.substitutedTeacher`, `Request.comments` |
| **30 Tage** | Freitext-Begründung wird gelöscht (auf `null` gesetzt) – kann Gesundheitsangaben enthalten (Art. 9 DSGVO) | `Absence.reason` |
| **400 Tage** | Datensatz wird vollständig gelöscht | Assignments, Requests, Absences (der Rest des Datensatzes), Push-Abos (`PushSubscription`) |
| **400 Tage nach Ende** | Beendeter Abwesenheitszeitraum wird gelöscht | `LeavePeriod` (laufende Zeiträume ohne Enddatum bleiben unberührt) |

Alle Fristen beziehen sich auf das jeweilige lokale Tagesdatum des betroffenen Datensatzes (z.B. `Request.date`, `Absence.date`, `PushSubscription.createdAt`) und werden auf lokale Tagesgrenzen normalisiert – die Uhrzeit des nächtlichen Laufs (02:00 Uhr) spielt für die Fristberechnung keine Rolle.

> [!NOTE]
> Für längere Abwesenheiten (`LeavePeriod` – Mutterschutz, Elternzeit, längere Erkrankung) gibt es bewusst **keine** Anonymisierungsstufe: Dort wird von vornherein nur der Zeitraum gespeichert. Der Grund ist ein Gesundheitsdatum nach Art. 9 DSGVO und wird gar nicht erst erfasst – er ist wie bisher auf dem Dienstweg zu melden.

### Prüfen, ob der Job durchläuft

`/api/cron/cleanup` schreibt nach jedem **erfolgreichen** Lauf einen Zeitstempel plus die Ergebniszahlen (z.B. Anzahl gelöschter Assignments) unter dem Schlüssel `lastGdprCleanup` in die `SystemSetting`-Tabelle und gibt denselben Wert auch in der JSON-Antwort zurück. So lässt sich jederzeit nachweisen, wann die Bereinigung zuletzt tatsächlich durchgelaufen ist (Rechenschaftspflicht, Art. 5 Abs. 2 DSGVO) – und ein seit Wochen scheiternder Job fällt auf, weil sich der Zeitstempel nicht mehr bewegt.

Der einfachste Weg – alle Meldungen des Zeitplans stehen im Container-Log:
```bash
sudo docker compose logs web | grep "DSGVO-CLEANUP"
```
Dort siehst du den Start des Schedulers, jeden durchgeführten Lauf samt Statistik und jeden Fehlschlag.

### Optional: zusätzlicher Cronjob von außen

Nur nötig, wenn du den eingebauten Zeitplan nicht nutzen willst (`GDPR_CLEANUP_SCHEDULER=off` in der `.env`) oder die Bereinigung zusätzlich von außen anstoßen möchtest. Dafür brauchst du ein `CRON_SECRET` in der `.env`:

```bash
0 2 * * * curl -X GET https://app.deine-domain.de/api/cron/cleanup -H "Authorization: Bearer DEIN_GEHEIMES_CRON_PASSWORT"
```

> [!WARNING]
> Ohne gesetztes `CRON_SECRET` antwortet `/api/cron/cleanup` bewusst mit HTTP 500 – die App authentifiziert lieber gar nicht, als mit einem leeren Secret. Der **eingebaute** Zeitplan läuft davon unabhängig und braucht kein Secret, da er nicht über das Netzwerk erreichbar ist.

Denk daran: Neue Werte in der `.env` übernimmt Compose nur mit `sudo docker compose up -d`, **nicht** mit `docker compose restart`.

### SMTP-Schlüssel rotieren

Bei einer geplanten Rotation wird der bisherige Wert vorübergehend als
`SMTP_ENCRYPTION_KEY_PREVIOUS` gesetzt und der neue Wert als `SMTP_ENCRYPTION_KEY`.
Ein erfolgreicher Mail-Test bzw. Versand verschlüsselt das gespeicherte Passwort mit
dem neuen Schlüssel. Danach kann `SMTP_ENCRYPTION_KEY_PREVIOUS` wieder entfernt werden.
Nie beide Schlüssel gleichzeitig verwerfen.

### Vollständige Sicherung & Private Uploads

#### Verwaltete Browser-Wiederherstellung für neue Installationen

Für eine neue produktive Instanz mit Browser-Wiederherstellung die
`docker-compose.managed.yml` verwenden. Sie ist kein Upgrade-Rezept für eine bereits
laufende Compose-Installation: einen **neuen Compose-Projektnamen** und ausschließlich
neue, leere Volumes für PostgreSQL, Uploads, Wiederherstellungszustand und Generationen
anlegen. Kein vorhandenes Produktions-Datenbank-Volume wiederverwenden.

In der `.env` müssen neben den normalen App-Schlüsseln eigene, verschiedene Werte mit
mindestens 32 Zeichen für `RECOVERY_AUTH_TOKEN`, `RECOVERY_CONTROL_TOKEN`,
`RECOVERY_RESCUE_TOKEN` und ein separates `RECOVERY_DATABASE_PASSWORD` stehen. Die
Compose-Datei veröffentlicht nur das Recovery-Gateway auf `127.0.0.1:${APP_PORT:-3000}`;
den bestehenden HTTPS-Proxy kontrolliert darauf weiterleiten. Der Web-Container hat
keinen Docker-Socket, das Laufzeit-Descriptor-Mount ist für ihn schreibgeschützt und
das private Klartext-Staging ist nicht im Web-Container eingehängt.

Immer das Image exakt in der Version und dem Commit des Backups bereitstellen. Die
Wiederherstellung richtet keinen Server, DNS, Zertifikate oder Reverse-Proxy ein und
ist kein Schutz gegen ein böswilliges oder zu großes Archiv: nur eigene Archive
verwenden und Speicher, CPU und PostgreSQL-Kapazität als Betreiber überwachen.

Nach erfolgreicher einmaliger Einrichtung erfolgt „Sicherung wiederherstellen“ unter
`/_recovery/` ohne Terminal. Aktuelles Schulamts-Passwort, bei leerer Instanz der
Einrichtungsschlüssel oder im Notfall der Betreiber-Rettungsschlüssel berechtigen den
Ablauf. Das Wiederherstellen tauscht Passwort-Hashes und damit den Datenstand aus;
vorhandene Browser-Sitzungen gelten nicht weiter. Nach dem Umschalten frisch anmelden,
Outbox kontrollieren und Mail, Push sowie Hintergrundjobs erst über „Benachrichtigungen
fortsetzen“ freigeben. Bei einem Fehler der Gateway-Initialisierung bleibt die Instanz
gesperrt und der Betreiber muss Konfiguration, Volumes und Logs prüfen.

Unter „Sicherung & Wiederherstellung“ erstellt die Anwendung ein passwortverschlüsseltes
Vollbackup (`.mrbackup`) mit Datenbank, Uploads, Passwort-Hashes und technischen Schlüsseln,
einschließlich der Mail-Zugangsdaten. Frühere JSON-Sicherungen werden bei der Dateiauswahl
weiterhin erkannt und können nach Bestätigung importiert werden; sie enthalten diese
Geheimnisse nicht und sind kein vollständiger Umzugsstand.

In der klassischen Installation bzw. vor dem ersten verwalteten Restore liegen die
Dateien in zwei Docker-Volumes:
1. `uploads-data` (`/app/public/uploads`): Öffentliche Assets (Schulamtslogo, Schulbilder).
2. `private-uploads-data` (`/app/private-uploads/signatures`): **Geschützte Unterschriften**, die ausschließlich über `/api/media/[filename]` mit Authentifizierung und Berechtigungsprüfung ausgeliefert werden.

Für eine zusätzliche serverseitige Sicherung außerhalb der App gehören zusammen:
1. PostgreSQL-Dump (`pg_dump`),
2. Sicherung der beiden Volumes `uploads-data` und `private-uploads-data`,
3. Sicher verwahrter `.env`-Datei (inklusive `SMTP_ENCRYPTION_KEY`, `INVITATION_TOKEN_PEPPER` und VAPID-Schlüsseln).

**Bei der verwalteten Installation reicht diese klassische Liste nicht aus:**
Nach einem Restore liegen die aktiven Uploads unter `recovery-data`; `recovery-runtime`
enthält den aktiven Datenbank-/Schlüssel-Deskriptor und `recovery-state` den geschützten
Auftragszustand einschließlich entschlüsseltem Staging. Für eine vollständige
Betreiber-Sicherung gehören diese drei Volumes, alle benötigten PostgreSQL-Datenbanken,
die ursprünglichen Upload-Volumes und die Host-Konfiguration zusammen. Ein solcher
Infrastruktur-Snapshot muss bei gestoppten Schreibprozessen konsistent erstellt werden;
ein unkoordiniertes Kopieren laufender PostgreSQL-Dateien ist kein Ersatz für ein Backup.
Für den normalen App-Umzug bevorzugt das konsistente verschlüsselte `.mrbackup` nutzen;
es sichert die aktive Generation unabhängig von diesen internen Speicherorten.
Proxy-Limits für Vollbackup-Upload und Export stehen in [FULL-BACKUP.md](./FULL-BACKUP.md).

Das neue App-Vollbackup enthält diese App-Daten bereits. Host-Compose-Dateien,
Pangolin/Newt und DNS bleiben separat zu sichern. Der verwaltete Ablauf ist in
[FULL-BACKUP.md](./FULL-BACKUP.md) beschrieben. `node scripts/restore-full-backup.mjs guided`
bleibt der CLI-Notfallpfad für isolierte Wiederherstellungen oder eine defekte
Gateway-Initialisierung. Es wird kein automatischer Sicherungsdienst eingerichtet.

---

## Teil 4: Migrationen & Wartungsskripte

### Rollout-Audit: vor dem nächsten Update prüfen

Die neuen Migrationen zunächst mit einer geschützten Kopie der eigenen Datenbank testen; vor der Produktionsmigration Datenbank, öffentliche Uploads, private Unterschriften und Schlüssel separat sichern. Die lokalen UI-Tests ersetzen diesen installationsbezogenen Probelauf nicht.

- `20260907143000_outbox_encrypted_payload_and_leases` entfernt alte Klartextfelder und verwirft aus Sicherheitsgründen die bisherigen Mail-Nutzdaten. Noch offene Altaufträge werden als nicht erneut zustellbar markiert. Vor dem Update den alten Mailausgang prüfen und offene Benachrichtigungen fachlich klären; diese Migration versendet sie nicht automatisch erneut.
- Neue Mailaufträge werden mit `SMTP_ENCRYPTION_KEY` verschlüsselt. Bei konfiguriertem Versand müssen Schlüssel und Mailkonfiguration vor dem ersten Fachvorgang gültig sein. Bei ausdrücklich übersprungener Mail-Einrichtung (`mailProvider=NONE`) bleiben Fachvorgänge möglich und zeigen einen Hinweis auf den fehlenden Versand.
- `20260907160000_request_idempotency_key` und `20260907163000_request_idempotency_fingerprint` sind zwei separate, additive Migrationen. Beide ausführen; eine bereits angewendete Migration nicht nachträglich bearbeiten.
- `20260907180000_add_school_navigation_points` ergänzt ausschließlich optionale Koordinaten für Eingang und Parkplatz. Bestehende Schulkoordinaten werden weder geändert noch automatisch als Eingang oder Parkplatz übernommen. Die neuen Punkte nach dem Update im Schulprofil bewusst setzen; der Schulstandort bleibt die Grundlage der Entfernungsmessung.
- Ein erfolgreicher Fachvorgang mit Versandwarnung darf nicht einfach erneut angelegt werden. Den E-Mail-Ausgang prüfen. Die Outbox schützt gegen konkurrierende Bearbeitung, kann aber bei einem Absturz direkt nach SMTP-Annahme keine absolut einmalige Zustellung garantieren.
- `GDPR_CLEANUP_SCHEDULER=off` deaktiviert nur die tägliche DSGVO-Bereinigung. Der Outbox-Takt bleibt standardmäßig aktiv; nur `OUTBOX_SCHEDULER=off` deaktiviert ihn ausdrücklich (z.B. für Tests oder einen separaten Mail-Worker).

### Migration auf private Unterschriften (`scripts/migrate-private-signatures.mjs`)

Bestehende Unterschriften, die vor diesem Update in `public/uploads/` gespeichert wurden, müssen in das geschützte Verzeichnis verschoben werden:

```bash
# Im Compose-Verzeichnis ausführen. Der Service heißt in docker-compose.prod.yml "web".
# Vorher prüfen, dass Compose genau diesen Service sieht:
sudo docker compose config --services | grep -x web
# Zuerst die Datenbankmigration im bereits gebauten App-Container einspielen.
sudo docker compose exec -T web npx prisma migrate deploy

# Danach die Dateimigration im selben Container ausführen (idempotent und sicher).
sudo docker compose exec -T web node scripts/migrate-private-signatures.mjs
```

* **Funktionsweise**: Das Skript liest ausschließlich in `SchulamtProfile.signatureUrl` referenzierte Dateien aus der Datenbank, kopiert sie zuerst nach `private-uploads/signatures/`, aktualisiert anschließend Datenbank und Eigentumsnachweis und entfernt die öffentliche Kopie erst nach erfolgreichem Commit. Fremde oder andere Uploads bleiben unberührt.
* **Rollback-Verfahren**: Sollte ein Rollback nötig sein, können die Dateien aus `private-uploads/signatures/` zurück nach `public/uploads/` verschoben werden und der Datenbankwert per SQL auf `/uploads/[filename]` zurückgesetzt werden:
  ```sql
  UPDATE "SchulamtProfile" SET "signatureUrl" = REPLACE("signatureUrl", '/api/media/', '/uploads/') WHERE "signatureUrl" LIKE '/api/media/%';
  ```

### Partieller Unique-Index auf Zuweisungen & Konfliktbehandlung

Die Migration `20260906120000_rollout_audit_hardening` erstellt einen partiellen eindeutigen PostgreSQL-Index:
```sql
CREATE UNIQUE INDEX "Assignment_teacher_active_date_unique"
ON "Assignment"("teacherId", "date")
WHERE "status" != 'REJECTED';
```

**Konfliktprüfung vor Index-Erstellung**:
Vor dem Anlegen des Index prüft das Migrationsskript vorhandene Datensätze. Sollten in einer Altdatenbank mehrere nicht stornierte Zuweisungen für dieselbe Lehrkraft und denselben Kalendertag existieren, **bricht die Migration kontrolliert mit einem Fehler ab**, anstatt Daten stillschweigend zu löschen.

**Vorgehen bei Migrationsabbruch**:
1. Abfrage der doppelten Zuweisungen:
   ```sql
   SELECT "teacherId", "date", COUNT(*)
   FROM "Assignment"
   WHERE "status" != 'REJECTED'
   GROUP BY "teacherId", "date"
   HAVING COUNT(*) > 1;
   ```
2. Manuelle Klärung mit dem Schulamt, welche Zuweisung gültig ist. Die ungültigen Zuweisungen auf `status = 'REJECTED'` setzen.
3. `sudo docker compose exec -T web npx prisma migrate deploy` erneut ausführen.

---

## Teil 5: Sicherheits-Audit & Abhängigkeiten (`npm audit`)

Nach der Aktualisierung auf Next.js 16.3.4, `eslint-config-next` 16.3.4 und
`tsx` 4.23.13 sind auch die zuvor nur transitiv eingebundenen Pakete abgesichert:

1. `@prisma/config` verwendet über die in `package.json` festgelegte Auflösung
   `deepmerge-ts` 8.0.2.
2. `exceljs` verwendet über die festgelegte Auflösung `uuid` 11.1.1.
3. Die mit `tsx` gelieferte `esbuild`-Version enthält die zugehörige Korrektur.

Der abschließende vollständige Lauf `npm audit` meldet **0 bekannte
Schwachstellen** in Produktions- und Entwicklungsabhängigkeiten. Bei künftigen
Paketaktualisierungen müssen die Auflösungen weiterhin durch `npm audit`, Build und
den Excel-Export-Test gegengeprüft werden; sie dürfen nicht ungeprüft entfernt werden.

---

## Teil 6: Server-Wartung & Aufräumen

### Wiederherstellung des Schulamtskontos

Eine Installation gehört genau einem Schulamt. Es gibt deshalb keinen technischen
Web-Admin und keine Web-Funktion zum Anlegen weiterer Schulämter. Wenn das
Schulamtskonto gesperrt ist oder sein Passwort verloren wurde, ist die
Wiederherstellung bewusst **nur mit Serverzugriff** möglich.

1. Auf dem Server in den Projektordner wechseln.
2. Das Skript in einem interaktiven Terminal im laufenden App-Container starten:
   ```bash
   docker compose exec -it app node scripts/recover-schulamt-account.mjs
   ```
   Bei der Produktions-Compose-Datei heißt der Dienst `web` statt `app`:
   ```bash
   docker compose -f docker-compose.prod.yml exec -it web node scripts/recover-schulamt-account.mjs
   ```
3. Die angezeigte Konto-E-Mail sorgfältig prüfen, die vollständige
   Bestätigungsphrase eingeben und ein neues Passwort zweimal eingeben.

Das Skript läuft ausschließlich mit TTY, akzeptiert Passwörter weder als
Kommandozeilenargument noch aus Umgebungsvariablen und verweigert die Aktion,
wenn nicht **genau ein** Schulamtskonto existiert. Es aktiviert das Konto wieder,
setzt ein neues Passwort und meldet mit der Sitzungsversion alle bisherigen
Sitzungen dieses Kontos ab. Bestehende Datenbankwerte mit der historischen Rolle
`ADMIN` werden dabei weder gelöscht noch verwendet.

Wenn du die App regelmäßig updatest, sammeln sich mit der Zeit alte, ungenutzte Docker-Images auf deinem Server an. Diese belegen unnötig Speicherplatz.

Du kannst deinen Server jederzeit mit folgendem Befehl aufräumen:
```bash
docker image prune -a -f
```
Der Befehl entfernt alle derzeit ungenutzten Images. Laufende Container und
Docker-Volumes mit der Datenbank werden nicht gelöscht; lokale Images für einen
schnellen Rollback können danach jedoch fehlen. Prüfe daher vorher mit
`docker image ls`, ob du ein bestimmtes Rollback-Image behalten möchtest.
