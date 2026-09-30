# Eigener Mailversand: Einrichtung in Etappen

Stand: 22.09.2026. Ergänzung zu [MAILVERSAND-PLAN.md](MAILVERSAND-PLAN.md).

Bestätigter Absender: **noreply@notify.mobilereserve.digital**. Mailservername: **smtp.notify.mobilereserve.digital**. Ausgehender TCP-Port 25 wurde vom Betreiber erfolgreich zu Google und IONOS getestet. UFW bleibt aktiv.

Diese Anleitung bereitet die Einrichtung vor. Bisher wurde kein Maildienst installiert. Die tatsächliche Docker-/Caddy-Konfiguration wurde noch nicht eingesehen; netzabhängige Einstellungen werden erst nach Abschnitt 1 eingesetzt. Die Repository-Dateien beschreiben den vorgesehenen Aufbau, belegen aber nicht den aktuellen Serverzustand.

## 1. Tatsächlichen Aufbau aufnehmen

Im SSH-Terminal des VPS ausführen. Die Befehle lesen nur Status, Namen und Netzwerkangaben; keine Container-Umgebungsvariablen oder Passwörter:

```bash
printf '\n--- Laufende Container ---\n'
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Networks}}\t{{.Ports}}'

printf '\n--- Docker-Netze ---\n'
sudo docker network ls

printf '\n--- IPv4-Adressen ---\n'
ip -4 -brief address

printf '\n--- IPv4-Routen ---\n'
ip -4 route

printf '\n--- Caddy-Dienst ---\n'
systemctl show caddy -p ActiveState -p FragmentPath

printf '\n--- Paketkandidaten ---\n'
apt-cache policy postfix opendkim dovecot-core certbot
```

Anhand der Ausgabe den MobileReserve-App-Container, dessen Netz, die zugehörige Bridge und die erreichbare Hostadresse bestimmen. Die genaue Compose-Datei und die Einbindung weiterer Caddy-Dateien anschließend gezielt ermitteln. Keine vollständige Ausgabe von `docker inspect` oder `docker compose config` teilen, weil sie Geheimnisse enthalten kann. Ein nicht gefundener Caddy-Systemdienst kann bedeuten, dass Caddy selbst als Container betrieben wird; dann muss der ACME-Webroot entsprechend in diesen Container eingebunden werden.

Debian 13 stellt Dovecot 2.4 bereit. Die spätere Konfiguration muss zu den tatsächlichen Paketkandidaten passen; Beispiele für Dovecot 2.3 nicht unverändert übernehmen.

## 2. DNS bei IONOS vorbereiten

Vor Änderungen im Netcup-SCP bestätigen, dass **185.207.105.248** die öffentliche IPv4 dieses VPS ist. Bestehende Einträge unter den unten genannten Namen zuerst prüfen, nicht doppelt anlegen.

In der DNS-Zone **mobilereserve.digital** folgende Einträge anlegen. Die Hostfelder sind relativ zur Hauptdomain angegeben; vor dem Speichern den vollständigen resultierenden Namen in der Oberfläche prüfen.

| Typ | Host | Wert | Zeitpunkt |
|---|---|---|---|
| A | smtp.notify | 185.207.105.248 | Nach IP-Bestätigung |
| TXT | notify | v=spf1 ip4:185.207.105.248 -all | Nach IP-Bestätigung |
| MX | notify | Ziel smtp.notify.mobilereserve.digital, Priorität 10 | Erst nach funktionsfähigem Empfang |
| TXT | mr1._domainkey.notify | Öffentlicher DKIM-Schlüssel | Nach Schlüsselerzeugung |
| TXT | _dmarc.notify | v=DMARC1; p=none; rua=mailto:dmarc@notify.mobilereserve.digital | Nach Einrichtung des Berichtspostfachs, vor Versand |

TTL für die Einrichtung beispielsweise 300 Sekunden, sofern angeboten. AAAA erst bei separat eingerichtetem und geprüftem IPv6-Mailbetrieb ergänzen. Die MX- und SPF-Einträge der Hauptdomain werden für diese Architektur nicht geändert. Ein Postfach bei IONOS wird für die neue Versand-Subdomain nicht benötigt.

Nach funktionierender A-Auflösung im Netcup-SCP den PTR der öffentlichen IPv4 auf **smtp.notify.mobilereserve.digital** setzen. Der vollständige Servername wird später auch als SMTP-Identität verwendet.

## 3. Zertifikat vorbereiten

Vorgesehen sind Certbot im Webroot-Modus und eine zusätzliche Caddy-Route für den neuen Mailservernamen. Bestehende Website-Blöcke und globale Einstellungen bleiben erhalten; vor einer Bearbeitung eine geschützte Sicherung der tatsächlichen Caddy-Konfiguration erstellen.

Für **Caddy als Hostdienst** ist folgender zusätzliche Site-Block vorgesehen, nachdem `/var/lib/mail-acme` samt Challenge-Verzeichnis angelegt und für Caddy lesbar gemacht wurde:

```caddyfile
http://smtp.notify.mobilereserve.digital {
    handle /.well-known/acme-challenge/* {
        root * /var/lib/mail-acme
        file_server
    }
    handle {
        respond 404
    }
}
```

`handle` erhält den vollständigen Challenge-Pfad. Der explizite HTTP-Block vermeidet hier einen zusätzlichen automatischen Caddy-Zertifikatsablauf für den Mailnamen. Bei Caddy im Container ist der Pfad erst nach passender Volume-Einbindung verwendbar.

Konfiguration vor dem Reload mit `caddy validate` prüfen. Mit einer harmlosen temporären Challenge-Datei die öffentliche HTTP-Erreichbarkeit testen. Danach Zertifikat über `certbot certonly --webroot` für den vollständigen Mailnamen ausstellen. Die ACME-Kontaktadresse muss ein bereits erreichbares und regelmäßig gelesenes Postfach sein.

Ein eigener Certbot-Deploy-Hook validiert die neue Zertifikatsdatei, stellt sie für Postfix mit engen Dateirechten bereit und lädt Postfix nach erfolgreicher Erneuerung neu. `certbot renew --dry-run`, den Hook und die Zertifikatsanzeige über SMTP getrennt prüfen. Caddy wird dafür nicht gestoppt, und kein zweiter Dienst belegt Port 80.

## 4. Maildienst und interne App-Verbindung

Nach Prüfung der Bestandsinstallation Postfix, OpenDKIM und Dovecot-Authentifizierung einrichten. Vor vorhandenen Mailkonfigurationen oder Konten haltmachen und diese berücksichtigen. Listener, automatische Starts und UFW so koordinieren, dass ein unvollständig konfigurierter Dienst nicht öffentlich erreichbar wird.

Die konkrete Konfiguration wird mit den Ergebnissen aus Abschnitt 1 erstellt. Sie muss folgende Punkte gemeinsam erfüllen:

- SMTP-Submission auf **587** nur über Loopback und eine ermittelte private Hostadresse, mit STARTTLS, gültigem Zertifikat und eigenem SMTP-Konto. Kein Vertrauen allein aufgrund der Zugehörigkeit zu einem Docker-Netz.
- Der App-Container erreicht den Host unter **smtp.notify.mobilereserve.digital** über eine gezielte interne Namenszuordnung. Zertifikatsprüfung bleibt aktiv. Die benötigte Compose-Ergänzung wird in die tatsächlich verwendeten Compose-Dateien integriert, damit sie auch bei Updates und Wiederherstellung gilt.
- Eine UFW-Eingangsregel erlaubt TCP 587 nur über die ermittelte Bridge, vom benötigten App-Netz zur passenden Hostadresse. Eine pauschale Regel für alle privaten Netze oder `ufw allow 587` ist nicht vorgesehen. Der reale Pfad wird aus dem App-Container geprüft; `deny (routed)` bleibt bestehen.
- Postfix nimmt auf **25** nur Nachrichten an die eingerichteten lokalen Rücklauf-/Betriebsempfänger an. Unbekannte Empfänger werden während SMTP abgewiesen, unberechtigtes Relaying ebenfalls. Öffentliche SMTP-Anmeldung wird dort nicht angeboten.
- Dovecot bietet ausschließlich den lokalen Authentifizierungssocket für Postfix an. SMTP-Konto getrennt von Betriebssystem- und App-Konten; keine öffentlichen IMAP-/POP-Listener. Dovecot-2.4-Syntax mit `doveconf` prüfen.
- DKIM-Schlüssel mit 2048 Bit, Selector **mr1**, Signaturdomain **notify.mobilereserve.digital**. Nur berechtigte Absender signieren; Signierausfall führt zu temporärer Ablehnung. Den ausgegebenen Public-Key im DNS veröffentlichen; der private Schlüssel bleibt auf dem Server.
- Envelope- und sichtbare Absenderberechtigungen müssen gemeinsam erzwungen werden. Postfix-Sender-Login-Maps allein prüfen nicht automatisch den sichtbaren From-Header. Die Submission-spezifische Headerprüfung wird ausdrücklich mitgetestet.
- Ausgehender Versand zunächst IPv4, TLS nach dem Plan verpflichtend. Die Fehlerbehandlung für Empfänger ohne TLS ist Teil der Abnahme. Lokale Systemmails, Postmaster und Rückläufer dürfen durch die Absenderregeln nicht unbemerkt unzustellbar werden.

## 5. Rückläufer betriebsbereit machen

Lokale Adressen **noreply**, **postmaster**, **abuse** und **dmarc** unter notify.mobilereserve.digital einrichten. Nachrichten gehen an ein zugriffsbeschränktes Betriebspostfach auf dem VPS. Verantwortliche Person, Leseweg und unabhängigen Alarmkanal vor Produktivstart festlegen. Keine Weiterleitung über das bisherige private Webhosting einrichten.

Nach Prüfung der Empfänger- und Relayregeln UFW um eingehendes TCP 25 ergänzen und die Netcup-Firewall gegenprüfen. Erst dann MX und DMARC-Berichtsadresse veröffentlichen. Von außen muss ein berechtigter lokaler Empfänger akzeptiert und eine unberechtigte externe Weiterleitung abgewiesen werden; zunächst ohne Nachrichteninhalt testen.

## 6. Abnahme und App-Umschaltung

Vor der produktiven App-Umschaltung die Testmatrix in MAILVERSAND-PLAN.md abarbeiten. Für tatsächliche Mails benennt der Betreiber freigegebene Testempfänger. Verbindungsaufbau und SMTP-Annahme ersetzen keine Kontrolle im Zielpostfach.

| App-Feld | Wert |
|---|---|
| Anbieter | SMTP |
| Host | smtp.notify.mobilereserve.digital |
| Port | 587 |
| Implizites TLS / smtpSecure | false; die App verlangt auf diesem Weg STARTTLS |
| Benutzer / Passwort | Separates neu angelegtes SMTP-Konto |
| Absenderadresse | noreply@notify.mobilereserve.digital |
| Absendername | Zum Beispiel MobileReserve – Schulamt Unterallgäu/Memmingen |

Anschließend den App-Testversand und wenige kontrollierte Fachvorgänge prüfen. App-Outbox, Postfix-Queue und Rückläufer gemeinsam beobachten. Postfix-Annahme bedeutet in der vorhandenen App bereits SENT; spätere Rückläufer erscheinen derzeit nicht automatisch in der App.

Erforderlich vor Abschluss: Zertifikatserneuerung, Neustart mit erhaltener Queue, Alarmierung, Wiederherstellungsablauf und Rückfallweg aus dem Plan prüfen. DNS, Konfiguration, Schlüssel und neue Zugangsdaten dokumentieren bzw. geschützt sichern.

## Referenzen

- [Debian-13-Paket Dovecot](https://packages.debian.org/trixie/dovecot-core)
- [Dovecot 2.4.1: passdb](https://doc.dovecot.org/2.4.1/core/config/auth/passdb.html)
- [Postfix: SASL](https://www.postfix.org/SASL_README.html)
- [Postfix: TLS](https://www.postfix.org/TLS_README.html)
- [Caddy: handle](https://caddyserver.com/docs/caddyfile/directives/handle)
- [Certbot: Webroot und Erneuerung](https://eff-certbot.readthedocs.io/en/stable/using.html)

Die Anleitung ist lokal vorbereitet, aber noch nicht auf Debian ausgeführt. Vollständige Postfix-/Dovecot-/DKIM-Konfigurationsdateien und genaue UFW-/Compose-Befehle folgen aus der Bestandsaufnahme; die beschriebenen Zielregeln sind noch keine angewendete Serverkonfiguration.
