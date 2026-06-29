# Das ultimative Deployment & Sicherheits-Handbuch

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

    location / {
        # Leitet alle Anfragen an unseren Docker-Container auf Port 3000 weiter
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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
Ändere unbedingt alle Passwörter (`POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_PASSWORD` etc.) in extrem sichere Werte um!

```bash
# Docker lädt die Datenbank und das fertige App-Image herunter und startet beides im Hintergrund (-d)
sudo docker compose up -d
```

> [!TIP]
> **Für zukünftige App-Updates auf diesem Server reicht:**
> `cd /opt/mobile-reserve && sudo docker compose pull && sudo docker compose up -d`

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
Öffne deine bestehende `.env` Datei (`nano .env`) und füge den neuen Refresh-Token-Secret hinzu, falls er fehlt:
```env
JWT_REFRESH_SECRET=dein_zweites_sicheres_passwort
```
*(Hinweis: Denke dir hier einfach selbst eine lange, zufällige Zeichenkette aus – genau wie beim ersten `JWT_SECRET`! Sie dient nur der Verschlüsselung im Hintergrund.)*

### Schritt 4: Neu starten
Starte das System nun mit der neuen Konfiguration:
```bash
docker compose up -d
```
Ab sofort zieht Docker beim Start das fertig gebaute Image (`ghcr.io/bastimuensch/...`), anstatt es jedes Mal mühsam lokal mit `build: .` zu kompilieren. Die bestehende Datenbank wird nahtlos weiterverwendet.

---

## Teil 3: Automatische DSGVO-Bereinigung (Cronjob)

Damit die App datenschutzkonform bleibt, muss sie regelmäßig alte Daten anonymisieren (z.B. Lehrernamen aus sehr alten Zuweisungen löschen). Hierfür muss dein Debian-Server diesen Prozess einmal pro Nacht (z.B. um 02:00 Uhr) anstoßen.

1. Stelle sicher, dass `cron` (der Zeitplaner von Linux) installiert und aktiv ist:
```bash
sudo apt-get update && sudo apt-get install -y cron curl
sudo systemctl enable cron --now
```

2. Öffne die Cronjob-Einstellungen deines Servers:
```bash
crontab -e
```
*(Falls du gefragt wirst, welchen Editor du nutzen willst, wähle `nano`).*

3. Füge ganz am Ende der Datei folgende Zeile ein (ersetze `app.deine-domain.de` und `DEIN_GEHEIMES_CRON_PASSWORT`):
```bash
0 2 * * * curl -X GET https://app.deine-domain.de/api/cron/cleanup -H "Authorization: Bearer DEIN_GEHEIMES_CRON_PASSWORT"
```

4. Speichern und schließen (`Strg+O`, `Enter`, `Strg+X`).

5. Öffne nun deine `.env`-Datei in `/opt/mobile-reserve/` und füge dort exakt dasselbe Passwort ein:
```env
CRON_SECRET=DEIN_GEHEIMES_CRON_PASSWORT
```
Starte danach den Container kurz neu (`sudo docker compose restart`), damit er das neue Passwort lädt. Ab jetzt läuft die DSGVO-Bereinigung jede Nacht vollautomatisch!

---

## Teil 4: Server-Wartung & Aufräumen

Wenn du die App regelmäßig updatest, sammeln sich mit der Zeit alte, ungenutzte Docker-Images auf deinem Server an. Diese belegen unnötig Speicherplatz.

Du kannst deinen Server jederzeit mit folgendem Befehl aufräumen:
```bash
docker image prune -a -f
```
*(Dieser Befehl löscht ausschließlich alte Container-Überreste. Deine aktuell laufende App und vor allem deine Datenbank bleiben davon zu 100% unberührt!)*
