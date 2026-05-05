# Deployment & Update Leitfaden: Mobile Reserven

Dieses Dokument beschreibt die initiale Installation der Plattform "Mobile Reserven" auf einem Linux-Server mit Docker sowie den standardisierten Prozess für das Einspielen zukünftiger Updates (ohne Datenverlust).

## Voraussetzungen auf dem Server
- Ein aktuelles Linux-Betriebssystem (z.B. Ubuntu 22.04 oder 24.04).
- Installiertes `docker` und `docker-compose` (bzw. das `docker compose` Plugin).
- Git (um das Repository herunterzuladen).

---

## 1. Initiale Installation (Erst-Setup)

### 1.1 Quellcode auf den Server laden
Klonen Sie das Repository auf den Server und wechseln Sie in das Projektverzeichnis:
```bash
git clone <IHR_GIT_REPOSITORY_URL> mobile-reserve
cd mobile-reserve
```

### 1.2 Umgebungsvariablen konfigurieren
Erstellen Sie eine produktive `.env`-Datei:
```bash
cp .env.example .env
# Falls keine .env.example vorhanden ist, erstellen Sie die Datei manuell:
nano .env
```
Füllen Sie die `.env` mit folgenden Werten:
```env
DATABASE_URL="file:./data/dev.db"
NEXTAUTH_URL="https://mobile-reserven.dein-schulamt.de" # Ihre echte Domain!
NEXTAUTH_SECRET="ihr_sehr_langer_zufaelliger_geheimer_schluessel"
```
*(Tipp: Generieren Sie das Secret z.B. mit `openssl rand -base64 32`)*

### 1.3 Container bauen und starten
Bauen Sie das Docker-Image und starten Sie den Container im Hintergrund:
```bash
docker-compose up -d --build
```
Beim ersten Start führt der Container automatisch `npx prisma migrate deploy` aus. Dadurch wird die leere Datenbank (`prisma/data/dev.db`) mit der korrekten Tabellenstruktur befüllt.

Das System läuft nun und lauscht standardmäßig auf Port `3000`. 
*(Tipp: Nutzen Sie einen Reverse-Proxy wie Nginx oder Traefik, um Port 3000 über HTTPS/Port 443 erreichbar zu machen).*

---

## 2. Zukünftige Updates durchführen (Wartung)

Wenn neuer Code geschrieben wurde (z. B. ein neues Design oder neue Datenbank-Felder), müssen Sie das System updaten. Durch die Trennung von Code und Daten (Docker Volumes) bleiben Ihre Schulen, Anfragen und Passwörter dabei unberührt.

### 2.1 Backup erstellen (Empfohlen)
Sichern Sie vor jedem Update die Datenbank-Datei. Da wir SQLite nutzen, ist das nur eine einzige Datei:
```bash
# Sichern Sie die Datei in einen Backup-Ordner mit Datum
cp prisma/data/dev.db ~/backups/dev_$(date +%F).db
```

### 2.2 System stoppen
Stoppen Sie den laufenden Container:
```bash
docker-compose down
```

### 2.3 Neuen Code herunterladen
Holen Sie sich die neuesten Änderungen aus dem Repository:
```bash
git pull origin main
```

### 2.4 Neues Image bauen und Container starten
Bauen Sie den Container von Grund auf neu (ohne Cache), damit alle neuen Node-Pakete und Änderungen übernommen werden, und starten Sie ihn danach:
```bash
docker-compose build --no-cache
docker-compose up -d
```

### Was passiert im Hintergrund beim Update?
1. Der neue Code (Next.js) wird kompiliert.
2. Der Container startet.
3. Der Startbefehl führt `npx prisma migrate deploy` aus. 
4. **Das Wichtigste:** Prisma gleicht die bestehende Datenbank mit dem neuen Code ab. Gibt es z.B. ein neues Feld für Lehrkräfte, wird dieses Feld sanft hinzugefügt, **ohne** vorhandene Datensätze zu löschen.
5. Die App fährt hoch und ist wieder erreichbar.

---

## 3. Fehlerbehebung / Logs

**Logs ansehen:**
```bash
docker-compose logs -f
```

**Datenbank-Konsole direkt im Container öffnen:**
```bash
docker exec -it mobile-reserve-app sh
npx prisma studio
```
*(Die Prisma Studio UI ist dann auf Port 5555 innerhalb des Containers erreichbar).*
