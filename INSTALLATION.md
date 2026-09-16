# Neue Installation mit automatischen Schlüsseln

Der Betreiber bereitet den Server einmalig vor; das Schulamt richtet anschließend
seine Organisation und Benutzer im Browser ein. Der Assistent ist **kein Update-
oder Reparaturwerkzeug für bestehende Installationen**.

## Was wird automatisch vorbereitet?

- Eine eigene Compose-Installation mit Browser-Wiederherstellung und zufälligem,
  dauerhaft in `.env` gespeichertem Projektnamen (getrennte Docker-Volumes).
- Unabhängige zufällige Schlüssel für Anmeldung, Einrichtung, SMTP-Verschlüsselung,
  Einladungen, Wiederherstellung, Cron sowie beide Datenbankrollen.
- Ein zusammengehöriges VAPID-Schlüsselpaar für Web-Push.
- Die abgefragte öffentliche HTTPS-Adresse und ein lokaler Gateway-Port.
- Eine feste App-Version statt `latest` sowie eine Anleitung zum Start und Prüfen.

Bestehende Ordner – auch leere oder symbolische Verknüpfungen – werden abgelehnt.
Es werden keine Container gestartet, alten Datenbanken eingebunden oder Schlüssel
einer laufenden Instanz verändert. Abgebrochene Vorbereitungen werden nicht durch
erneute Schlüsselgenerierung überschrieben.

## Start aus dem Quellcode

Voraussetzung: Node.js 24 und ein Checkout, der diese Dateien bereits enthält.
Für die Vorbereitung sind weder `npm install` noch eine Datenbank erforderlich.
Im Projektverzeichnis ausführen:

```sh
node scripts/setup-instance.mjs
```

Der Assistent fragt einen **noch nicht vorhandenen Zielordner**, die öffentliche
Adresse (etwa `https://uamm.mobilereserve.digital`), einen freien lokalen Port und
ein veröffentlichtes Release ab. Der übergeordnete Ordner muss bereits existieren.
Den neuen Ordner nur in einem vertrauenswürdigen, nicht allgemein beschreibbaren
Verzeichnis anlegen. Das App-Release muss vorher erfolgreich veröffentlicht worden
sein; der Assistent prüft nicht die Registry.

Danach die erzeugte `START.md` befolgen: Compose-Konfiguration ohne Geheimnisausgabe
prüfen, Images laden, starten und Status kontrollieren. Die Dateien `.env` und
`ZUGANGSDATEN.txt` sind nur für ihren Besitzer lesbar (0600), der Ordner hat 0700.
NAS-ACLs und Administratorzugriffe muss der Betreiber zusätzlich beachten.
Die Schlüsseldateien sind **nicht passwortverschlüsselt**; sie werden für den Start
benötigt. Keine dieser Dateien in Git, Chats oder öffentliche Downloads übernehmen.

## NAS ohne installiertes Node.js

Ab Image-Version **0.1.10** kann dessen Node-Laufzeit
verwendet werden. Mit `docker run --rm -it`, `--entrypoint node`, einem festen
Image-Tag und einem einzigen Bind-Mount eines eigens vorgesehenen Installations-
Elternordners starten; als Skript `/app/scripts/setup-instance.mjs` angeben.
Keinen Docker-Socket oder bestehende Produktionsordner einbinden. Host-Benutzer-ID
und Gruppen-ID über `--user` übernehmen, damit die erzeugten Dateien dem Betreiber
gehören. Den Elternordner möglichst am **gleichen absoluten Pfad** einbinden, damit
die Startbefehle auch auf dem Host stimmen.

Das ältere Image **0.1.9 enthält diesen neuen Assistenten noch
nicht**. Dafür die Quellcode-Variante verwenden. Ein herunter-
geladenes neueres Skript allein macht ein altes Image nicht automatisch kompatibel.

## Vor Freigabe an Lehrkräfte

1. DNS, gültiges TLS und Reverse Proxy auf den **Gateway** einrichten. Standard:
   `127.0.0.1:3120`. PostgreSQL und Webprozess werden nicht öffentlich freigegeben.
   Ein separater Proxy-/Newt-Container benötigt eine passende interne Anbindung;
   dessen `127.0.0.1` ist nicht das Loopback des Hosts.
2. Öffentliche Adresse im Browser öffnen. Einrichtungsschlüssel aus
   `ZUGANGSDATEN.txt` verwenden und das Schulamtskonto mit eigenem Passwort anlegen.
   Es gibt keine erzeugten Standard-Benutzerpasswörter.
3. Im Installationsordner mit einem Image, das den neuen Check enthält:

   ```sh
   sudo docker compose exec -T web node scripts/check-installation.mjs
   ```

   Das prüft technische Konfiguration, Datenbankverbindung und PostgreSQL-16-
   Werkzeuge. Es verändert keine Daten und zeigt weder Schlüssel noch Passwörter.
   Gemeldete fehlende Schlüssel bei Altinstallationen **nicht blind ersetzen**:
   bereits verschlüsselte Maildaten und offene Einladungen können davon abhängen.
4. Anmeldung, Einrichtung, Mailversand (falls eingerichtet) sowie ein verschlüsseltes
   Vollbackup prüfen. Einen Wiederherstellungstest nur in einer getrennten
   Testinstallation durchführen. Der lesende Check ersetzt diesen Test nicht.

DNS/TLS, freie Ports, Proxy-Limits, ausreichender Speicher, Betriebssystem-Updates
und ein externes Backup-Ziel richtet der Assistent nicht ein. Die dafür nötigen
Schritte stehen in [DEPLOYMENT.md](DEPLOYMENT.md) und [FULL-BACKUP.md](FULL-BACKUP.md).

## Updates, Schlüssel und Umzug

Bei Neustarts und Updates bleiben `.env`, Projektname und Schlüssel unverändert.
Nicht erneut den Assistenten ausführen und keine neuen Projektnamen an Compose
übergeben. Den Image-Tag bewusst aktualisieren. Für den Umzug das verschlüsselte
Vollbackup samt gesondert verwahrtem Passwort verwenden; ein Restore erfordert
die passende App-Version **und denselben Commit**.

Infrastruktur einschließlich Reverse Proxy, DNS und Betreiber-/Notfallschlüsseln
separat gesichert aufbewahren. Das App-Backup ersetzt diese Sicherung nicht. Die
Vorbereitung einer neuen verwalteten Instanz wandelt eine bestehende klassische
NAS-Installation nicht automatisch in eine verwaltete Instanz um.
