# Vollbackup: Wer sichert was – und wie wird wiederhergestellt?

## Kurzfassung

Das Schulamt lädt in der App eine verschlüsselte **`.mrbackup`-Datei** herunter.
Sie enthält den vollständigen Stand dieser App-Instanz einschließlich der bisherigen
Logins und technischen Schlüssel. Das angezeigte **Backup-Passwort** gehört getrennt
in einen Passwortmanager. Datei und Passwort werden gemeinsam für eine Wiederherstellung gebraucht.

Der **Serverbetreiber** richtet einmalig die verwaltete Wiederherstellungs-Installation
ein. Danach kann ein berechtigtes Schulamt ein eigenes, vertrauenswürdiges Vollbackup
im Browser einspielen; die App wird dabei kontrolliert in eine neue Generation
umgeschaltet. Der bisherige Terminal-Ablauf bleibt der Notfallpfad.

Diese Funktion richtet **keinen automatischen täglichen Sicherungsdienst** ein.
Für den Produktivbetrieb zusätzlich regelmäßige, verschlüsselte Sicherungen außerhalb
des NAS mit Wiederherstellungsproben einrichten. Eine Kopie nur auf dem NAS hilft
nicht beim Verlust des NAS.

## Zuständigkeiten und Aufbewahrung

| Wer? | Aufgabe | Wo liegt das Ergebnis? |
|---|---|---|
| Berechtigtes Schulamt | In „Dokumentation → Sicherung & Wiederherstellung“ auf „Vollbackup herunterladen“ klicken; das aktuelle Anmeldepasswort nochmals eingeben | Zunächst nur eine verschlüsselte Datei im Browser-Arbeitsspeicher |
| Dieselbe Person | Angezeigtes Backup-Passwort kopieren, getrennt aufbewahren, das Kontrollkästchen bestätigen und herunterladen | `.mrbackup` im gewählten Download-Ordner; Passwort separat im Passwortmanager |
| Schulamt / benannter Serverbetreiber | Prüfen, ob die Datei vollständig gespeichert wurde; auf den freigegebenen Sicherungsspeicher außerhalb des NAS übertragen | Verschlüsselter Sicherungsspeicher mit begrenzten Zugriffsrechten |
| Serverbetreiber | Wiederherstellungsprobe und später vollständiger Umzug | Leere, isolierte Zielinstanz; danach kontrollierte Freigabe |

Jeder neu erstellte Export bekommt ein eigenes zufälliges Passwort. Der Dialog zeigt
es ausdrücklich an und bleibt nach dem Download offen. „Erneut herunterladen“ lädt
dieselbe Datei mit demselben Passwort. Nach Schließen wird es nicht dauerhaft in der
App aufbewahrt; die App kann es später nicht wieder anzeigen. Im Passwortmanager den
Dateinamen zur Zuordnung notieren. Das Backup-Passwort ist **nicht** das Anmeldepasswort.

Wer Datei **und** Passwort besitzt, kann sämtliche enthaltenen Zugangsdaten und
personenbezogenen Daten wiederherstellen. Keine Weitergabe per ungeschützter E-Mail.
Downloads nur auf freigegebenen Geräten durchführen. Aufbewahrungsdauer und Löschung
der Sicherungen müssen mit dem zuständigen Datenschutz-/Betriebskonzept abgestimmt werden.

## Was ist enthalten?

- Die gesamte App-Datenbank, einschließlich aller Schuljahre, Schulen, Reserven,
  Anforderungen, Einsätze, Abwesenheiten, Einstellungen und Migrationshistorie.
- Alle Benutzerkonten mit ihren **Passwort-Hashes**, Rollen und Aktivierungsständen.
  Die bisherigen Passwörter funktionieren nach Wiederherstellung weiter. Passwörter
  werden nicht nachträglich im Klartext ausgelesen.
- Mail-Konfiguration einschließlich gespeichertem SMTP-Passwort und dessen
  Verschlüsselungsschlüssel. Ebenso verschlüsselte Mail-Outbox, Einladungs- und
  Passwort-Reset-Datensätze, Push-Abonnements und gespeicherte Push-Schlüssel.
- Alle regulären Dateien unter `public/uploads` und `private-uploads`, einschließlich
  Unterschriften. Ein abweichend konfiguriertes Unterschriftsverzeichnis wird ebenfalls gesichert.
- Die wirksamen, von der App verwendeten Umgebungsvariablen, insbesondere Datenbankzugang,
  JWT-/SMTP-/Einladungsschlüssel, App-URL und optionale VAPID-Konfiguration.
- App-Version, Commit, PostgreSQL-Version und die mit der App ausgelieferte
  Produktions-Compose-Vorlage. Das Werkzeug erzeugt daraus eine portable Startkonfiguration.

Die Sicherung enthält **nicht** das NAS-Betriebssystem, andere Anwendungen, Domains/DNS,
Pangolin-/Newt-Konfiguration, externe Mailkonten, Zertifikatsverwaltung oder individuell
geänderte Host-Compose-Dateien/Proxy-Regeln. Auch extern gehostete Bilder bleiben externe
URLs. Diese Infrastruktur sichert der Betreiber separat. Die App erhält dafür keinen
Zugriff auf den Docker-Socket oder beliebige Dateien des NAS.

Die Datenbank wird mit einem konsistenten PostgreSQL-Snapshot exportiert. Uploads
werden davor/danach verglichen; fehlende referenzierte Dateien oder Änderungen brechen
den Export ab. Es wird kein teilweise erfolgreiches Backup angeboten. Ein endgültiger
Umzug braucht dennoch ein Wartungsfenster, damit nach dem letzten Export keine neuen
Einträge auf dem alten Server entstehen.

## Verschlüsselung und Voraussetzungen

Authentifizierte Verschlüsselung mit AES-256-GCM, zufälligem Salt/Nonce und scrypt
(N=32768, r=8, p=1). 24 zufällige Passwortbytes werden als 32 URL-sichere Zeichen angezeigt.
Beim Export werden Passwort und Klartextinhalt nicht als URL, Dateiname, Log oder dauerhafte
Serverdatei abgelegt. Bei der Wiederherstellung werden entschlüsselte Daten dagegen in
einem geschützten Betreiber-Volume vorbereitet und aufbewahrt; dieses Volume muss wie
die Datenbank selbst geschützt werden. Der Export erfolgt nur nach erneuter Passwortprüfung durch ein
aktives Schulamtskonto; alte GET-Downloads liefern keine unverschlüsselten Daten mehr.

Die Browser-Funktion ist für einzelne Schulamtsinstanzen begrenzt auf 64 MiB
Datenbank-Dump, 64 MiB Uploads und 10.000 Dateien. Bei Überschreitung schlägt der Export
sichtbar fehl, statt Dateien auszulassen. Dann ist eine serverseitige Sicherung für
größere Bestände nötig. Reverse-Proxy-Timeout für diesen Export auf mindestens
240 Sekunden abstimmen. Der Docker-Container enthält `pg_dump` und `pg_restore`;
bei einer Installation ohne das offizielle Image muss der Betreiber kompatible
PostgreSQL-Clientwerkzeuge bereitstellen.

## Vollständig wiederherstellen

### Empfohlen: verwaltete Browser-Wiederherstellung

Der Betreiber richtet dies **einmal pro neuer Installation** ein, nicht bei jeder
Sicherung. Dazu `docker-compose.managed.yml` mit einem eigenen Compose-Projektnamen,
eigenen leeren Volumes und einer vollständigen `.env` verwenden. Niemals auf ein
bestehendes Produktions-PostgreSQL-Volume zeigen oder dessen Volumenname übernehmen.
Die Vorbereitung samt Schlüsselerzeugung übernimmt für neue, getrennte Ordner der
[Installationsassistent](INSTALLATION.md); vorhandene Deployments verändert er nicht.
Die verwaltete Compose-Datei bringt Gateway, Steuerdienst und Webprozess mit; die
Web-App erhält weder Docker-Socket noch Zugriff auf die Steuer-Geheimnisse.

Der Reverse Proxy muss weiterhin auf den öffentlichen Port des **Gateways** zeigen,
nicht direkt auf den Webprozess. Für `/_recovery/api/upload` bis zu **193 MiB**
Anfragegröße und mindestens 240 Sekunden Upload-Zeit erlauben; alle übrigen
Upload-Limits bleiben unverändert. Bei Nginx beispielsweise zusätzlich im passenden
`server`-Block:

```nginx
location = /_recovery/api/upload {
    client_max_body_size 193m;
    client_body_timeout 240s;
    proxy_read_timeout 240s;
    proxy_send_timeout 240s;
    proxy_request_buffering off;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Für `/api/backup/export` den `proxy_read_timeout` ebenfalls auf mindestens 240
Sekunden setzen. Bei Pangolin/Traefik die entsprechenden Grenzen am tatsächlich
vorgeschalteten Proxy prüfen. Der Gateway-Port bleibt an Loopback gebunden; ein
Proxy in einem anderen Container benötigt eine gezielt eingerichtete interne
Netzwerkverbindung und darf nicht pauschal alle internen App-Ports veröffentlichen.

Das Image muss exakt zur im Backup gespeicherten **Version und zum Commit** passen.
Keine Wiederherstellung mit `latest`, einem anderen Branch oder einer nebenbei
aktualisierten PostgreSQL-Hauptversion erzwingen. Es wird in demselben PostgreSQL-Cluster
wiederhergestellt, aber nicht in einer Ressourcen-Sandbox: ausschließlich eigene,
vertrauenswürdige Archive verwenden und CPU, Arbeitsspeicher sowie freien Speicher des
Servers überwachen.

Nach der Einrichtungsprüfung öffnet der Betreiber `/_recovery/` in der normalen
geschützten App-Adresse. Dort läuft der weitere Ablauf ohne Terminal:

1. Mit dem aktuellen Schulamtskonto und Passwort anmelden; bei einer leeren Instanz
   stattdessen den Einrichtungsschlüssel, im Notfall den separaten Betreiber-
   Rettungsschlüssel verwenden.
2. Die eigene `.mrbackup` auswählen, Backup-Passwort eingeben, Prüfung abwarten und
   die Wiederherstellung ausdrücklich bestätigen.
3. Der Dienst stoppt die Web-App, erstellt die neue Generation, prüft sie zuerst
   schreibgeschützt und schaltet sie erst nach zwei erfolgreichen Bereitschaftsprüfungen
   öffentlich frei. Browser schließen oder die Statusseite neu laden bricht den
   dauerhaften Auftrag nicht ab.
4. Danach mit einem **frischen Login** prüfen: Das Backup stellt Passwort-Hashes und
   Konten wieder her, nicht bestehende Browser-Sitzungen. Alte Sitzungen sind ungültig.
   Mail-/Push-Versand und Hintergrundjobs bleiben pausiert. Zuerst Outbox prüfen,
   fachlich freigeben und erst dann im Wiederherstellungsportal Benachrichtigungen
   fortsetzen.

Die Wiederherstellung installiert keinen Server, richtet weder DNS noch Zertifikate ein
und ersetzt keine Host-/Proxy-Konfiguration. Alte Generationen und Archive bleiben zur
Kontrolle erhalten; nach zehn aufbewahrten Aufträgen oder bei knappem Speicher muss der
Betreiber bewusst prüfen und aufräumen. Das Klartext-Staging privater Dateien wird nicht
in den Web-Container eingehängt. Separate Betreiber-Backups der Server-Volumes bleiben
trotzdem erforderlich.

Schlägt die Initialisierung des Gateways fehl, bleibt die öffentliche App absichtlich
gesperrt. Das Portal kann keine defekte Server-, DNS-, Zertifikats- oder Volume-
Konfiguration automatisch reparieren; Betreiber-Logs und der folgende Notfallpfad sind
dann maßgeblich.

### Notfallpfad: geführter CLI-Assistent


Der frühere App-Einstieg **„Sicherung wiederherstellen“** erkennt Dateien weiterhin
lokal – unabhängig von Dateiname oder Endung – und verändert bei der Auswahl noch
nichts. Ein erkanntes Vollbackup ist erst durch das Server-Werkzeug auf Passwort und
Integrität geprüft. Für den hier beschriebenen Notfallpfad folgt anschließend der
Terminal-Assistent; alte Sicherungen bleiben im gesonderten Importablauf.

Für ein Vollbackup auf dem Zielserver im passenden App-Projektordner starten:

```bash
node scripts/restore-full-backup.mjs guided
```

Voraussetzungen: **Node.js 24 auf dem Zielserver**, ein lokaler Docker-Dienst mit
Docker Compose, Docker-Berechtigungen und die vier zusammengehörigen Skripte
`restore-full-backup.mjs`, `guided-full-backup.mjs`, `full-backup-format.mjs` und
`full-backup-runtime.mjs`. PostgreSQL-Clientprogramme auf dem Host sind beim Assistenten
nicht nötig; der Datenbankimport läuft im passenden App-Image. Der Assistent wird auf
dem Host ausgeführt, nicht im normalen Web-Container; kein Docker-Socket für die App.
Falls Node.js auf dem NAS fehlt, zuerst gezielt bereitstellen oder den unten beschriebenen
Container-/Einzelschritt-Ablauf nutzen. Es wird nichts ungefragt installiert.

Der Assistent fragt nach:

1. Der Backupdatei und einem **neuen, noch nicht vorhandenen Zielordner**.
2. Einem freien lokalen Port (Vorgabe 3120).
3. Dem Backup-Passwort, verdeckt eingegeben.
4. Der ausdrücklichen Bestätigung `WIEDERHERSTELLEN` vor dem Anlegen des neuen Stacks.
5. Optional `STARTEN`, erst nachdem die Wiederherstellung erfolgreich war.

Er erzeugt einen eigenen zufälligen Docker-Projektnamen, verwendet eine neue Datenbank,
prüft vor dem Import deren leeren Zustand und richtet die Rechte der neu entpackten
Upload-Verzeichnisse ein. Bestehende Container, Datenbanken und Host-Verzeichnisse werden
nicht überschrieben. Ohne Startbestätigung bleibt der neue Stack gestoppt.
Bei Fehlern wird versucht, nur den neuen Stack zu stoppen; keine Daten/Volumes werden
automatisch gelöscht. Der entschlüsselte, vertrauliche Zielordner bleibt auch bei Abbruch erhalten.

**`ASSISTENT-ERGEBNIS.txt` im Zielordner** enthält den eindeutigen Projektnamen und die
passenden Status-/Stoppbefehle. Erst nach erfolgreicher Wiederherstellung steht dort auch
der Startbefehl. Diese Befehle verwenden, nicht einen anderen Compose-Projektnamen:
Andernfalls würde Docker ein anderes Datenbank-Volume anlegen.

Die neue App ist nur über `127.0.0.1` am Zielserver erreichbar. Für Fernzugriff einen
geschützten Tunnel/Proxy einrichten. DNS und öffentliche Freigabe erfolgen nicht automatisch.
Vor einer Probe ausgehenden Mail-/Push-Verkehr sperren; beim produktiven Umzug die alte
Instanz anhalten. Die übrigen Prüfungen unter „Prüfen, dann produktiv freigeben“ bleiben nötig.

### Alternative: Einzelschritte für Betreiber

Die folgenden Befehle sind für einen **neuen, isolierten Zielordner** gedacht, nicht
für die bestehende Produktionsinstallation. Versionsplatzhalter durch die im Backup
gesicherte Release-Version ersetzen, die bereits das neue Backup-Werkzeug enthält.
Beim ersten Test unterstützend die passende Version aus dem Projekt verwenden.

### 1. Archiv prüfen und entschlüsseln

Auf einem geschützten Rechner mit Node.js 24 und den drei Dateien aus demselben
App-Stand (`restore-full-backup.mjs`, `full-backup-format.mjs`, `full-backup-runtime.mjs`):

```bash
node scripts/restore-full-backup.mjs extract /absoluter/pfad/sicherung.mrbackup /absoluter/pfad/neue-wiederherstellung
```

Das Werkzeug fragt das Passwort verdeckt ab. Es kommt **nicht** in die Befehlszeile
oder Shell-History. Vor dem Schreiben werden Verschlüsselung, Integrität und Dateipfade
geprüft. Der Zielordner muss neu sein; vorhandene Ordner werden nicht überschrieben.

Alternativ das im passenden App-Image enthaltene Werkzeug in einem kurzlebigen
Container verwenden, mit einem eng begrenzten Backup-Verzeichnis als Mount. Kein
Docker-Socket und keine produktiven Daten-Volumes anhängen.

Danach liegen im Zielordner:

| Datei/Ordner | Zweck |
|---|---|
| `database.dump` | Vollständige Datenbank für `pg_restore` |
| `public-uploads/`, `private-uploads/`, ggf. `custom-signatures/` | Wiederhergestellte Upload-Dateien |
| `environment.original.json` | Originale App-Konfiguration einschließlich Geheimnissen |
| `compose.restore.json` | Vorbereiteter neuer Docker-Stack; enthält ebenfalls Geheimnisse |
| `compose.reference.yml` | Originale mitgelieferte Compose-Vorlage, nicht die individuelle Host-Datei |
| `manifest.json` | Zeitpunkt, Versionen und Prüfsummen |

**Dieser entpackte Ordner ist nicht mehr verschlüsselt.** Rechte sind bewusst 0700
für Verzeichnisse und 0600 für Dateien. Nur Betreiber dürfen zugreifen. Nicht ins
Git-Repository, keinen Webordner und nicht in einen frei erreichbaren NAS-Share legen.

### 2. Nur die neue Datenbank starten

Im neuen Zielordner:

```bash
sudo docker compose -p mobile-reserve-restore -f compose.restore.json up -d postgres
sudo docker compose -p mobile-reserve-restore -f compose.restore.json exec postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Erst fortfahren, wenn PostgreSQL bereit ist. Projektname und Volumes sind eigenständig.
Die erzeugte Vorlage verwendet PostgreSQL 16 wie die derzeitige Anwendung; beim
Umzug keine gleichzeitige Hauptversionsmigration vornehmen.

Bei einem Entwicklungs-/Branch-Build lässt sich das Archiv ebenfalls entschlüsseln,
aber das Werkzeug erzeugt bewusst keine Compose-Datei mit einem möglicherweise
inzwischen veränderten `main`-Image. Dann muss der Betreiber den in `manifest.json`
aufgezeichneten Commit bauen bzw. das zugehörige Image bereitstellen.

### 3. Datenbank vollständig einspielen

```bash
sudo docker compose -p mobile-reserve-restore -f compose.restore.json run --rm --no-deps \
  -v "$PWD/database.dump:/restore/database.dump:ro" \
  --entrypoint node web scripts/restore-full-backup.mjs database \
  /restore/database.dump LEERE-ZIELDATENBANK-WIEDERHERSTELLEN
```

Die Dump-Datei muss für den Containerbenutzer lesbar sein (UID/GID 1000 im aktuellen
Image). Auf dem Zielserver vorab die Eigentümer **gezielt für die entpackten Dateien**
anpassen; nicht pauschal NAS-Verzeichnisse freigeben. Das gilt auch für die Uploadordner.
Gegebenenfalls den einmaligen Restore-Container mit `--user 0:0` ausführen; die Web-App
selbst bleibt beim unprivilegierten Benutzer.

Das Werkzeug verweigert eine nicht leere Zieldatenbank. Es löscht keine vorhandenen
Tabellen. Die eigentliche Wiederherstellung ist eine einzelne Transaktion; bei Fehlern
wird sie zurückgerollt. Ein SQL-Dump ist ausführbarer Datenbankinhalt: ausschließlich
eigene, vertrauenswürdige Backups verwenden.

### 4. Prüfen, dann produktiv freigeben

1. Eigentümer und Rechte der drei Upload-Verzeichnisse für die App prüfen.
2. `compose.restore.json` kontrollieren: Version, Ports, Domain und Schlüssel.
3. Zunächst nur isoliert starten. Mail-Outbox- und Bereinigungs-Scheduler sind in der
   erzeugten Konfiguration absichtlich abgeschaltet. Für eine Wiederherstellungsprobe
   zusätzlich ausgehenden Mail-/Push-Verkehr blockieren; ein ausgeschalteter Scheduler
   verhindert nicht jede direkt durch eine Benutzeraktion ausgelöste Nachricht.
4. Die drei Rollen mit den bisherigen Passwörtern prüfen, danach Schuljahre, Einsätze,
   PDFs, Logo, Unterschriften und Einstellungen. Vor Versandtests Freigabe einholen.
5. Zum echten Umzug Änderungen/Benutzerzugriffe und Hintergrundjobs auf der alten
   Instanz anhalten. Für den abschließenden Browserexport die App nur für den Betreiber
   erreichbar lassen, Scheduler abschalten. Letztes Backup erstellen, alte App stoppen,
   letzte Sicherung erneut in eine leere Zielinstanz einspielen.
6. Vor Freigabe Mail-Outbox kontrollieren: Eine Wiederherstellung eines älteren Standes
   kann bereits versendete Nachrichten wieder als ausstehend enthalten. Nur eine
   Instanz darf versenden. Scheduler-Werte nach Prüfung aus der Originalkonfiguration
   übernehmen, Proxy/DNS kontrolliert umstellen und neue Instanz freigeben.

Bei gleicher Domain und übernommenen Schlüsseln bleiben vorhandene Links und
Push-Zuordnungen grundsätzlich nutzbar; Ablaufzeiten werden nicht verlängert.
Die alte Instanz bleibt aus. Falls auf dem neuen Server bereits Änderungen eingegangen
sind, ist ein Rückwechsel kein einfaches DNS-Zurückstellen: diese Änderungen müssen
zuvor gesichert/übernommen werden.

## Alte JSON-Sicherungen

Unter „Sicherung wiederherstellen“ werden frühere Formate 1.0/2.0 automatisch erkannt
und können nach Bestätigung wie bisher eingespielt werden. Sie enthalten **keine
vollständigen Logins/technischen Schlüssel** und ersetzen das neue Vollbackup nicht.
Vollbackups werden bei eingerichtetem Gateway zur Browser-Wiederherstellung geführt;
ohne Gateway wird auf die einmalige Betreiber-Einrichtung verwiesen. Sie werden nie
an den JSON-Import gesendet.
Vor jedem Import in eine bestehende Instanz ein aktuelles Vollbackup sichern.

## Prüfung vor einer Veröffentlichung

`npm run check` prüft Lint, TypeScript, Unit-/Schnittstellentests und Produktionsbuild.
`TEST_DATABASE_URL=… npm run test:integration` benötigt ausschließlich eine explizite,
isolierte Testdatenbank und prüft auch den verschlüsselten Vollbackup-Rundlauf sowie
die eingeschränkte Wiederherstellungs-Generation. Niemals eine Produktionsdatenbank
als Testdatenbank verwenden.

Die GitHub-Action ergänzt `scripts/check-managed-recovery.mjs`: ein eigener Docker-Stack
mit echten Next-/PostgreSQL-Prozessen, Export, Upload, Umschaltung, Sitzungsentwertung
und expliziter Versandfreigabe. Dieser Docker-Gesamttest muss vor einer produktiven
Freigabe bestanden sein. Ein erfolgreicher lokaler Build allein reicht dafür nicht.
