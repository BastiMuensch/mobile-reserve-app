# Eigener Mailversand auf dem Netcup-VPS

Planungsstand: 22.09.2026. Keine Installation oder Serveränderung durch diesen Plan. Serverbefunde beruhen auf den vom Betreiber ausgeführten Tests; App-Befunde auf dem lokalen Quellcode.

## 1. Nachgewiesene Voraussetzungen

- Debian 13, 4 CPUs, etwa 6,9 GiB verfügbarer RAM und 235 GB freier Speicher zum Testzeitpunkt. Für einen schlanken Maildienst ist ausreichend Reserve erkennbar; das spätere Versandvolumen ist noch festzulegen.
- UFW aktiv: eingehend verweigern, ausgehend erlauben, gerouteten Verkehr verweigern. Eingehend sind bisher nur 22, 80 und 443/TCP erlaubt.
- Vor Entfernung der Netcup-Mail-Block-Policy scheiterten beide SMTP-Verbindungstests. Danach antworteten Google und IONOS auf Port 25 mit einem 220-Banner. Der ausgehende Verbindungsweg zu diesen beiden Zielen funktioniert.
- Die Banner belegen weder STARTTLS noch Mailannahme, IP-Reputation oder Posteingangszustellung. Es wurden keine Nachrichten gesendet.
- Die öffentliche App-Adresse zeigt auf 185.207.105.248. Ihr PTR lautet derzeit v2202609413449522149.megasrv.de und löst auf dieselbe IP auf. Die IP vor DNS-Änderungen im SCP bestätigen.
- MobileReserve unterstützt bereits SMTP-Anmeldung, TLS, konfigurierbare Ports und Absender sowie eine verschlüsselte Outbox mit Wiederholungsversuchen.

## 2. Vorgesehene Architektur

MobileReserve-Container → SMTP mit STARTTLS und Anmeldung auf dem VPS → direkte SMTP-Zustellung an die Empfänger-Mailserver.

Postfix wird als Debian-Dienst auf dem Host geplant. OpenDKIM übernimmt die Signatur. Ein Dovecot-Authentifizierungsdienst stellt separate SMTP-Zugangsdaten bereit; öffentliche IMAP-/POP-Dienste werden nicht benötigt. Das ist eine Planungsentscheidung, noch keine installierte Konfiguration. Paketversionen und insbesondere die Dovecot-Konfigurationssyntax sind vor der Umsetzung anhand der installierten Debian-Pakete zu prüfen.

Postfix bekommt eine dauerhafte Queue, begrenzte Versandraten und ein eigenes Betriebspostfach für Rückläufer. Der Versand erfolgt ohne Weiterleitung über das private Webhosting. Für weitere Apps werden später eigene Konten eingerichtet und deren Anbindung separat getestet.

Eine zusätzliche HTTP-Mail-API ist für MobileReserve nicht erforderlich. Die vorhandene SMTP-Anbindung verlangt Benutzername, Passwort und TLS; ein unverschlüsseltes anonymes Relay wäre damit auch keine passende Standardkonfiguration.

## 3. Domain und DNS festlegen

Vom Betreiber bestätigte Domain- und Absenderwahl; DNS-Einträge noch nicht veröffentlicht:

| Zweck | Vorgeschlagener Wert |
|---|---|
| Versanddomain | notify.mobilereserve.digital |
| Mailservername | smtp.notify.mobilereserve.digital |
| App-Absender und zunächst Envelope-Absender | noreply@notify.mobilereserve.digital |
| Betriebspostfächer | postmaster, abuse, dmarc und noreply unter der Versanddomain |

Domain und Absender sind bestätigt. Noch festzulegen sind der sichtbare Absendername, die zuständige Person für Rückläufer, das ungefähre Tagesvolumen und freigegebene Testempfänger. Die vorhandenen IONOS-MX-Einträge und der SPF-Eintrag der Hauptdomain mobilereserve.digital bleiben bestehen. Die neuen Einträge betreffen ausschließlich die Versand-Subdomain; die bisherige DNS-Prüfung weist auf eine Verwaltung bei IONOS hin.

Geplante DNS-Einträge nach Bestätigung der IP:

| Name | Typ | Inhalt |
|---|---|---|
| smtp.notify.mobilereserve.digital | A | 185.207.105.248 |
| notify.mobilereserve.digital | MX | 10 smtp.notify.mobilereserve.digital. |
| notify.mobilereserve.digital | TXT | v=spf1 ip4:185.207.105.248 -all |
| mr1._domainkey.notify.mobilereserve.digital | TXT | DKIM-Public-Key, nach Erzeugung des 2048-Bit-Schlüssels |
| _dmarc.notify.mobilereserve.digital | TXT | v=DMARC1; p=none; rua=mailto:dmarc@notify.mobilereserve.digital |

Den PTR der IPv4 im SCP auf smtp.notify.mobilereserve.digital setzen und Vorwärts-/Rückwärtsauflösung prüfen. Zunächst ausschließlich IPv4-Versand planen; IPv6 erst mit eigener verifizierter Adresse, PTR, SPF und Zustelltest ergänzen. DNS-TTL für die Einrichtung beispielsweise 300 Sekunden, später erhöhen. DMARC erst nach Auswertung der Tests und Berichte auf quarantine/reject umstellen.

## 4. Server und Firewall umsetzen

1. Tatsächliche Host-, Caddy- und Docker-Konfiguration lesen, belegte Ports und App-Netze aufnehmen. Konfiguration und bisherige SMTP-Einstellungen geschützt sichern. Keine Geheimnisse ins Repository übernehmen.
2. Postfix, DKIM-Signierung und SMTP-Authentifizierung zunächst ohne produktive App-Anbindung konfigurieren. Eigener starker SMTP-Zugang mit Passwort-Hash im Authentifizierungsdienst; erlaubte Envelope- und sichtbare From-Absender auf das Konto beschränken. Unbekannte lokale Empfänger bereits im SMTP-Dialog ablehnen.
3. Öffentlich gültiges Zertifikat für den Mailservernamen einrichten. ACME-Erneuerung mit dem bestehenden Caddy abstimmen: beispielsweise separater HTTP-01-Webroot und eine gezielte Caddy-Route, ohne Port 80 durch einen zweiten Server zu belegen. Nach Erneuerung Zertifikate mit engen Dateirechten bereitstellen und Postfix neu laden. Erneuerungsablauf testen.
4. Submission auf Port 587 nur an einer aus dem App-Netz erreichbaren privaten Hostadresse bereitstellen. Erst nach Ermittlung des Docker-Netzes die konkrete Adresse und UFW-Regel festlegen. Der App-SMTP-Hostname muss trotz interner Auflösung zum Zertifikat passen. 127.0.0.1 im App-Container bezeichnet nicht den VPS-Host.
5. UFW aktiv lassen. Für Submission nur das tatsächlich benötigte App-Netz beziehungsweise den konkreten Netzwerkpfad zulassen. Docker-Netze nicht pauschal als vertrauenswürdige Relays behandeln. Authentifizierung bleibt erforderlich; deny (routed) nicht global aufheben.
6. Öffentliches TCP 25 eingehend erst für den betriebsbereiten Empfang von Rückläufern freigeben. Port 25 nimmt ausschließlich Nachrichten an die festgelegten lokalen Betriebsempfänger an, ohne SMTP-AUTH oder Weiterleitung an beliebige externe Empfänger. Kein Catch-all. Port 465 wird nicht benötigt, Port 587 bleibt öffentlich gesperrt. Netcup-Firewall und UFW gemeinsam prüfen.
7. Ausgehend bleibt TCP 25 erforderlich. App → Postfix muss TLS einschließlich Zertifikatsprüfung verwenden. Für Postfix → Empfänger wird als Ausgangsplanung TLS verpflichtend vorgesehen; Empfänger ohne TLS bleiben in der Queue und erzeugen einen Betriebsalarm. Diese Wahl muss an den tatsächlichen Zielsystemen getestet werden. Postfix-TLS-Stufe encrypt allein garantiert keine authentifizierte Gegenstelle; DANE/MTA-STS beziehungsweise zielbezogene Zertifikatsprüfung sind getrennt zu bewerten. Kein stiller Rückfall auf Klartext.
8. DKIM-Signierung an authentifizierte, erlaubte Absender binden. Bei Ausfall des Signierdiensts sollen neue App-Mails vorübergehend abgewiesen und erneut versucht werden, statt unsigniert zu versenden.

## 5. Rückläufer, Betrieb und Datenschutz

Die erste Version verwendet noreply@notify.mobilereserve.digital auch als erreichbaren Rücklaufempfänger. Postfix stellt Rückläufer und Betriebsmails in ein lokales, zugriffsbeschränktes Postfach zu. Es wird vor Produktivstart festgelegt, wie die zuständige Person dieses liest; für den Anfang ist administrativer Zugriff über SSH möglich. Benachrichtigungen über neue Rückläufer und Queue-Probleme dürfen nicht ausschließlich vom gerade gestörten SMTP-Dienst abhängen. Ein unabhängiger Alarmkanal ist vor Produktivstart festzulegen und zu testen.

MobileReserve markiert eine Mail nach SMTP-Annahme als SENT und entfernt dann den verschlüsselten Payload aus der App-Outbox. Ein späterer Zustellfehler wird derzeit nicht in die App zurückgemeldet. Daher gehören Postfix-Queue und Rückläufer zwingend zur Betriebsprüfung. Eine automatische Zuordnung von Rückläufern zur App wäre eine spätere Erweiterung mit stabilen Nachrichtenkennungen.

Vorgeschlagene Startwerte: maximal 20 MiB Gesamtgröße einer Mail, Alarm bei mehr als 50 wartenden Nachrichten oder einer ältesten Nachricht über 15 Minuten, Warnung bei weniger als 20 Prozent freiem Queue-Dateisystem und bei Zertifikatsrestlaufzeit unter 14 Tagen. Größenlimit anhand realer PDF-/Kalenderanhänge und Versandrate anhand des erwarteten Spitzenvolumens abstimmen. Vorübergehende Fehler wiederholt Postfix begrenzt; permanente Fehler und Ablauf der maximalen Queue-Laufzeit erzeugen Rückläufer. Maximale Queue-Laufzeit als Startwert 48 Stunden einplanen und fachlich abstimmen.

SMTP-Queues, Rückläufer und Logs können Nachrichteninhalte, Adressen und Anhänge enthalten. Die App-Verschlüsselung schützt nicht automatisch den Postfix-Spool. Dateizugriff begrenzen, Aufbewahrung festlegen und Backups verschlüsseln. Vorschlag zur Abstimmung: Logs 14 Tage, erledigte Rückläufer 7 Tage; keine unnötigen Inhaltskopien in Alarmen. Schlüssel, Konfiguration und Betriebspostfach in den Wiederherstellungsplan aufnehmen. Eine restaurierte Queue darf keine bereits zugestellten Mails erneut senden.

Die vorhandene VPS-Vertragsabdeckung, Zuständigkeiten und Beschreibung des Mailversands in den Datenschutzunterlagen sind vor Produktivstart anzupassen bzw. zu bestätigen; aus der technischen Machbarkeit folgt keine Vertragsprüfung.

## 6. Test und Abnahme

Zunächst nur synthetische Nachrichten an vom Betreiber ausdrücklich benannte Testempfänger senden. Die bisherigen Verbindungstests sind keine Erlaubnis, beliebige Empfänger anzuschreiben.

| Test | Abnahmekriterium |
|---|---|
| DNS und Identität | A/PTR stimmen überein, SPF enthält Versand-IP, DKIM-Key und DMARC sind öffentlich auflösbar |
| App-Netz → Submission | TLS-Zertifikat gültig, richtige Zugangsdaten funktionieren, falsche werden abgelehnt |
| Relay- und Absenderschutz | Externe Weiterleitung ohne Anmeldung und Versand unter fremdem Absender werden abgelehnt; Test vor DATA beenden |
| DKIM-Ausfall | Temporäre Ablehnung/Queue, keine unsignierte Auslieferung |
| Echte Testzustellung | Kontrolliertes Google-/IONOS-Postfach und mindestens ein repräsentatives Schul-/Behördenpostfach prüfen; Banner allein zählen nicht |
| Empfängerprüfung | Rohheader zeigen SPF/DKIM/DMARC pass und passende Domainausrichtung; Posteingang/Spamordner kontrollieren |
| Inhalte | Umlaute, HTML/Text, PDF- und Kalenderanhänge sowie eine repräsentative größte Mail korrekt |
| Rückläufer | Kontrollierter ungültiger Empfänger unter einer eigenen Testdomain erzeugt sichtbar verarbeitbaren Rückläufer |
| Temporärer Ausfall | Isoliertes Testziel liefert temporären Fehler; Queue, Alarm und spätere Zustellung funktionieren |
| Neustart und Zertifikat | Queue übersteht Neustart; Erneuerung und Reload funktionieren |

Kontrollierte Fehlerfälle vor der produktiven Umschaltung durchführen; keine globale Netzsperre für die laufenden Apps erzeugen. Zustelltests belegen den getesteten Zeitpunkt und Empfängerkreis, keine dauerhafte Zustellgarantie.

## 7. Umschaltung und Rückfallweg

Nach erfolgreicher Abnahme in MobileReserve den neuen SMTP-Host, Port 587, STARTTLS (smtpSecure=false bei vorhandener requireTLS-Logik), eigenes Konto und bestätigte Absenderadresse eintragen. Den Profil-Testversand prüfen und anschließend wenige kontrollierte Fachvorgänge durchführen. Mindestens zwei Arbeitstage Queue, Rückläufer und Authentifizierungsergebnisse beobachten; erst dann weitere Apps anbinden.

Bei Störungen zuerst neue SMTP-Annahmen gezielt unterbrechen, damit neue konfigurierte App-Mailaufträge in der App-Outbox verbleiben. mailProvider=NONE ist hierfür ungeeignet, weil neue Vorgänge dann ohne Mailauftrag weiterlaufen können. Allein das Stoppen des Outbox-Schedulers verhindert ebenfalls nicht die unmittelbaren Sendeversuche der App.

Vor Umschalten auf einen Ersatzdienst die bereits von Postfix angenommenen Nachrichten erfassen und bei Bedarf gezielt anhalten. App-SENT-Einträge nicht pauschal erneut versenden. Alte und neue Queue eindeutig abgleichen, um Doppelversand zu verhindern. Ein vorhandener SMTP-Anbieter ist nur dann Rückfallziel, wenn seine Nutzung weiterhin organisatorisch und vertraglich zulässig ist; das private Webhosting wird nicht automatisch als Ersatz festgelegt. Andernfalls kontrollierter Versandstopp mit sichtbarer Störungsmeldung und manueller Bearbeitung dringender Fälle.

DNS und Rücklaufempfänger nach einem Rückfall nicht sofort entfernen: Noch unterwegs befindliche Nachrichten und Rückläufer müssen weiter verarbeitet werden. Konfigurationen und Schlüssel bis zur abgeschlossenen Nachkontrolle geschützt aufbewahren.

## 8. Nächster Schritt

Die bestätigte Domainwahl ist in den DNS-Werten oben berücksichtigt. Die [Installationsanleitung](MAILVERSAND-INSTALLATION.md) ist mit DNS-, Zertifikats- und Einrichtungsschritten vorbereitet. Als Nächstes die lesende Bestandsaufnahme aus deren Abschnitt 1 ausführen, um genaue UFW-/Compose-Regeln und Mailkonfigurationen an den laufenden Docker-/Caddy-Aufbau anzupassen. Vor Veröffentlichung die VPS-IP im SCP bestätigen. A, SPF und PTR können danach vorbereitet werden; MX und DMARC-Berichtsadresse erst mit betriebsbereitem Rückläufer-/Berichtsempfang aktivieren. Den DKIM-TXT-Eintrag nach Erzeugung des Schlüssels ergänzen und alle Einträge vor dem ersten Versand prüfen. Der erfolgreiche Port-25-Test muss derzeit nicht wiederholt werden. Installation, DNS-Änderung und echter Testversand sind noch nicht erfolgt.

## Technische Referenzen

- [Netcup SMTP-Block und Firewall](https://www.netcup.com/de/helpcenter/dokumentation/server/firewall)
- [Netcup Server-Netzwerk](https://www.netcup.com/de/helpcenter/dokumentation/server/netzwerk)
- [Postfix SASL und Absenderberechtigungen](https://www.postfix.org/SASL_README.html)
- [Postfix TLS und Sicherheitsstufen](https://www.postfix.org/TLS_README.html)
- [Postfix Relay-Zugriffsschutz](https://www.postfix.org/SMTPD_ACCESS_README.html)
- [OpenDKIM unter Debian](https://wiki.debian.org/opendkim)
- [Google-Absenderrichtlinien](https://support.google.com/mail/answer/81126?hl=de)
- Lokale Implementierung: src/lib/email.ts, src/lib/emailOutbox.ts und docker-compose.managed.yml.
