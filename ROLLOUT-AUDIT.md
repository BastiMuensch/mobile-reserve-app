# Ergänzender Funktions- und UI-Audit – 8. Oktober 2026

## Ergebnis und Umfang

Die Klassenkontinuität und die schuljahrbezogene Stundenübersicht wurden technisch sowie in der Oberfläche geprüft. Alle nachfolgend beschriebenen Änderungen liegen lokal vor; es wurden keine produktiven Daten migriert und nichts veröffentlicht. Der Test verwendete ausschließlich künstliche Konten und getrennte PostgreSQL-Datenbanken.

## Behobene technische Fehler

- Einzelvorschläge berücksichtigen alle neu angebotenen Stunden je betroffener Woche. Freie Tage bleiben bei teilweise belegten, abwesenden oder nicht zum Teilzeitplan passenden Tagen verfügbar. Geschlossene Bedarfe werden nicht vorgeschlagen.
- Stornierte Anforderungen zählen weder als belegte Tage noch als Wochenstunden. Historisch verbliebene aktive Zuweisungen werden bei einer erneuten Zuweisung innerhalb derselben Transaktion auf storniert gesetzt; echte Doppelbuchungen und Rollbacks bleiben geschützt.
- Mehrarbeitskandidaten werden auch in den Alternativen der Idealbesetzung entsprechend nachrangig bewertet. Der Zuweisungsdialog übernimmt vollständige Tagesstunden und kürzt spätere Wochen nicht anhand einer pauschalen Reststundenzahl.
- Langsame Abrufe der Stundenübersicht werden durch den 15-Sekunden-Aktualisierungstakt nicht mehr ständig abgebrochen. Gleichzeitige Abrufe werden zusammengefasst; Zeitüberschreitung, erneuter Versuch und Schuljahreswechsel sind abgesichert. Veraltete Daten bleiben gekennzeichnet sichtbar, Downloads sind bis zum erfolgreichen Aktualisieren gesperrt.
- Gelöschte Reserven führen bei der nächsten Aktualisierung nicht zu einem unsichtbar verbliebenen Filter. Datenstand und mögliche historische Lücken durch die bestehende 400-Tage-Löschfrist erscheinen in Oberfläche und CSV.
- Backup-Importe normalisieren fachliche Kalendertage einschließlich Sommer-/Winterzeit und Schuljahresgrenze; echte Zeitstempel bleiben unverändert. Jahresexporte zählen stornierte Anforderungen nicht als aktive Stunden.
- Eine schnelle Neuanmeldung wartet jetzt auf die abgeschlossene Push-Abmeldung und Cookie-Widerrufung; eine verspätete Abmeldung kann keine neue Sitzung mehr wieder löschen. Im Browser durch direkten Kontowechsel verifiziert.
- Der Node-spezifische Bereinigungsdienst wird nur innerhalb des positiven Next.js-Laufzeitzweigs importiert. Dies behebt den beim Entwicklungsstart aufgetretenen Edge-Bundle-Fehler.
- Die transitive Abhängigkeit `postcss-selector-parser` ist auf die korrigierte Version 7.1.6 festgelegt.

## Oberfläche und Bedienung

- Menüpunkt „Stunden & Statistik“ und erklärende Seitentexte grenzen Stundenübersicht, Regierungs-Monatsmeldung, Dokumentation und Sicherungen voneinander ab.
- Reservenaktionen stehen nur auf Übersicht und Reservenverwaltung. Mobile Navigation erhält ein passendes Öffnen-/Schließen-Label, Escape schließt das Menü und gibt den Fokus zurück.
- Die Datumswahl erklärt, welche Woche und welcher Monat angezeigt werden. Auf kleinen Bildschirmen ersetzen Karten die breite Vergleichstabelle; die Verlaufstabelle ist per Tastatur erreichbar und als seitlich verschiebbar gekennzeichnet.
- Klassen sind schon in der kompakten Bedarfsliste sowie im Lehrkraft-Dashboard sichtbar. Kandidaten zeigen die Anzahl ihrer tatsächlich verfügbaren Tage und die bisherige wöchentliche Belegung.
- Native Datumsfelder und Auswahlelemente übernehmen das dunkle Farbschema; der Kalenderknopf bleibt sichtbar. Archivtexte berücksichtigen die tatsächliche Löschfrist.

## Nachweise

- 353 automatische Tests bestanden; 30 datenbankabhängige Tests im allgemeinen Lauf erwartungsgemäß ausgelassen und separat ausgeführt.
- 68 PostgreSQL-Integrationstests bestanden (66 im Hauptlauf sowie je ein Vollbackup- und Wiederherstellungstest). Einschließlich Import-Roundtrip, Mandantentrennung, Arbeitslast, Stornierungen, paralleler Zuweisungen, Transaktions-Rollbacks und Datenmigrationen.
- ESLint, TypeScript, Produktions-Build und Diffprüfung erfolgreich.
- Produktionsabhängigkeiten: `npm audit --omit=dev` meldet zum Prüfzeitpunkt 0 Schwachstellen. Der gesamte Abhängigkeitscheck besteht mit der bereits im Repository dokumentierten, bis 5. November 2026 befristeten Ausnahme für die ausschließlich in Entwicklungswerkzeugen verwendete `braces`-Abhängigkeit.
- Browser: Anmeldung/Abmeldung aller drei Rollen, Schulbedarf mit Klassenangabe, Vorwochenhinweis, gemeinsame Zuweisung von sechs tatsächlich freien Tagen, anschließende gemeinsame Lehrkraftbestätigung; außerdem Idealbesetzung, Schulamt-Menüpunkte, Jahreswechsel, Leerzustände, Personenfilter, Monats-/Wochenverlauf und CSV-Download.
- Der heruntergeladene CSV wurde gegen die Anzeige geprüft: vor Bestätigung 40 UStd. im Schuljahr, 32 im Monat und 8 in der Woche für die Testreserve, davon 12/4/0 bestätigt. Nach der Bestätigung bleiben die Summen unverändert, nur die Bestätigungsanteile wechseln.
- Responsive Prüfung bei 390 und 320 Pixeln ohne horizontalen Seitenüberlauf; mobile Menübedienung einschließlich Escape und Fokus sowie Hell-/Dunkelmodus. Screenshot: `output/ui-audit/stunden-statistik-audit.jpg`.

## Grenzen

Die Übersicht zählt geplante bzw. bestätigte **Unterrichtsstunden**, keine tatsächlich gemessene Arbeitszeit einschließlich Fahrten oder Vor-/Nachbereitung. „Gesamt“ bezeichnet das ausgewählte Schuljahr. SMTP-Versand an echte Empfänger, produktiver HTTPS-/Push-Betrieb und Docker-Deployment waren nicht Teil dieses lokalen Tests. Die neue additive Migration `20261008120000_request_class_name` wird beim regulären Rollout benötigt.

---

# Rollout-Audit und UI-Überarbeitung – 7. September 2026

## Freigegebener Stil auf weitere Ansichten übertragen

Nach Freigabe der überarbeiteten Übersicht wurde derselbe Stil auf Reserven, Schulen, Freigaben, Lehrkraft-/Schul-Dashboard, Bedarfsformular, Idealbesetzung, Statistik, Dokumentation und Einstellungen übertragen. Die Änderungen betreffen Darstellung und Bedienbarkeit; Logo, Schrift, rechtliche Texte und Berechtigungen bleiben erhalten. Die doppelte Einladungsaktion auf der Reservenseite wurde entfernt; die Aktion in der gemeinsamen Kopfzeile bleibt bestehen.

Die Prüfung vor dem Push hat zusätzlich den fehlenden Docker-Kontextschutz geschlossen: `.dockerignore` verhindert die Übernahme lokaler Geheimnisse, Datenbanken, Uploads, Caches und Arbeitsartefakte in lokale Docker-Builds. Geminis Arbeits-Diff und ursprüngliche `Task.md` bleiben lokal erhalten und werden nicht mit versioniert. Ein Docker-Build konnte lokal mangels Docker nicht ausgeführt werden; der Repository-Workflow baut das Image nach dem Push. Ein Push auf `main` erzeugt keinen stabilen Release-/`latest`-Tag.

Für die Browser-Schreibtests am Produktions-Build müssen neben der isolierten Datenbank auch die Testwerte für `JWT_SECRET`, `INVITATION_TOKEN_PEPPER`, `SMTP_ENCRYPTION_KEY` und `NEXT_PUBLIC_APP_URL` gesetzt sein; beide Scheduler werden dafür ausgeschaltet. Die Tests verwenden Chromium-Fetch mit dem echten Secure-Cookie-Verhalten auf Loopback, ohne die Produktions-Cookie-Sicherheit zu reduzieren.

Die abschließenden UI- und HTTP-Schreibtests sind gegen den Produktions-Build erfolgreich durchgelaufen. Beide Browserprüfungen erlauben mit `UI_TEST_BASE_URL` einen abweichenden lokalen Testport (abschließend `http://127.0.0.1:3117`) und lehnen nicht lokale Ziele ab. Eine bereits laufende Vorschau eines anderen Projekts wurde nicht verändert.

## UI-Nachbesserung nach Rückmeldung

Die Schulamt-Übersicht wurde enger an den zuvor freigegebenen Bildentwurf angepasst: größere mehrzeilige Bedarfszeilen mit Schulicon und sichtbarer Aktion, zurückhaltende Kennzahlen-Karten, weniger verschachtelte Rahmen und eine farblich ruhigere echte Karte. Spätere Bedarfe sind zunächst eingeklappt; Suche und Direktlinks öffnen die relevanten Einträge automatisch. Original-Logo, Rubik, Berechtigungen und Fachabläufe sind unverändert. Die übrigen Rollenansichten wurden in dieser Nachbesserung nicht umgestaltet.

Produktions-Build, TypeScript, gezieltes ESLint sowie Browserprüfungen einschließlich Tastatur-Aufklappen, Suche, Direktlink, Matching, Jahreswechsel und Mobilansichten erfolgreich. Ein neuer Screenshot mit ausschließlich synthetischen Daten liegt in `output/ui-audit/schulamt-entwurf-umgesetzt.png`.

## Ziel und Umfang

Die freigegebenen Verbesserungen wurden in kleinen Arbeitspaketen mit Terra-Agenten umgesetzt und anschließend durch den Hauptagenten geprüft, korrigiert und zusammen getestet. Der bereits vorhandene, umfangreich geänderte Arbeitsstand wurde erhalten. Commit und Push sind zum Abschluss ausdrücklich freigegeben. Es erfolgten kein produktives Deployment und keine Migration der eigentlichen Anwendungsdatenbank.

Die Anwendung bleibt eine Instanz für ein Schulamt. Original-Logo und Rubik-Schrift bleiben erhalten; der verbindliche BayTGV-Text wurde durch diese UI-/Audit-Runde nicht verändert. Der Bestätigungs-PDF-Endpunkt erlaubt nur der betroffenen Lehrkraft und dem zuständigen Schulamt Zugriff, nicht Schulen. Web Push bleibt auf Lehrkräfte beschränkt; E-Mail wird dadurch nicht auf Lehrkräfte beschränkt.

## Umgesetzt

### Oberfläche und Arbeitsabläufe

- Schulamt: feste Seitennavigation am Desktop, mobile Navigation, kompakte Kennzahlen, Bedarfsliste und Karte nebeneinander, vergrößerbare Karte, sichtbarer Aktualisierungsstand, Freigabe- und Mailausgangshinweise.
- Ruhigere Flächen, klarere Abstände und Kontraste; weniger Blur-/Bewegungseffekte. Die bestehenden Seiten und Funktionen bleiben erreichbar.
- Schul- und Lehrkraft-Dashboard kompakter; die ausstehende Einsatzbestätigung steht vor ergänzenden Kennzahlen. Schulhinweise können bewusst in einen Bedarf übernommen werden, ohne vorhandene Eingaben zu überschreiben.
- Ein vollständiger, schuljahrgebundener Datenstand ersetzt die vorherigen Teilergebnisse. Fehlgeschlagene Abrufe zeigen Fehler statt falscher Leerzustände. Beim Jahreswechsel werden keine Daten des vorherigen Jahres angezeigt; die Jahresauswahl überlebt ein Neuladen.
- Matching-Ergebnisse sind an Bedarf, Schuljahr und Datenrevision gebunden. Veraltete Ergebnisse berechtigen nicht zu einer Zuweisung. Optionale Profilfehler blockieren bei HTTP-Fehlerantworten nicht die Bedarfsplanung.
- Registrierungen zeigen die an den gültigen Einladungslink gebundene E-Mail schreibgeschützt. Die Kartenposition ist zusätzlich per Tastatur/Koordinateneingabe mit Dezimalkomma einstellbar, auch bei Geocoding-Ausfall.

### Datenintegrität und Benachrichtigungen

- Lehrkraft bearbeiten: ein leeres optionales Passwort verlangt keinen Passwortwechsel; leere optionale Felder werden normalisiert. Ein gewöhnlicher Speichervorgang aktiviert keine gesperrte Lehrkraft. Gemeinsame Kontodaten werden konsistent gehalten, schuljahrsbezogene Angaben bleiben getrennt.
- Neue Bedarfe verwenden einen dauerhaften Idempotenzschlüssel mit normalisiertem Inhalts-Fingerprint: gleiche Wiederholung liefert denselben Bedarf, geänderter Inhalt unter demselben Schlüssel einen Konflikt. Ein neuer Schlüssel erlaubt einen legitimen weiteren Bedarf.
- Abwesenheiten werden vor dem Speichern auf betroffene Einsätze geprüft. Die Bestätigung ist an Zeitraum und Einsatzmenge gebunden; ein neuer Einsatz zwischen Vorschau und Speicherung erzeugt einen Konflikt. Dieser Schutz gilt auch für die Änderungs-API und über personenbezogene Schuljahreszeilen hinweg.
- Bei Bedarfserstellung, Zuweisung, Stapelzuweisung, Einsatzbestätigung/-stornierung, Ausfall, Abwesenheit und Rückkehr werden die betreffenden Mailaufträge innerhalb der Fachtransaktion verschlüsselt gespeichert. SMTP und Push laufen erst danach. Ausdrücklich übersprungene Mail-Einrichtung erlaubt die Fachänderung mit Warnhinweis.
- Eine Einsatzbestätigung ist wiederholbar, ohne wiederholt Mails anzulegen. Paralleles Beenden einer offenen Vertretung wird als Konflikt behandelt.
- Outbox-Aufträge werden unmittelbar vor ihrer Verarbeitung einzeln beansprucht; konkurrierende Worker dürfen keine fremde Beanspruchung abschließen. Versandfehler werden getrennt vom fachlichen Erfolg angezeigt.
- Der automatische Outbox-Takt ist unabhängig vom DSGVO-Takt. `OUTBOX_SCHEDULER=off` ist die gesonderte Abschaltung, etwa für isolierte Tests.
- Passwort-Reset-Anfragen widerrufen nicht länger bereits gültige Links; höchstens drei offene Links je Konto. Ein erfolgreicher Passwortwechsel entwertet die übrigen Links und bestehende Sitzungen.

### Backup

- Die zusammengehörigen Datenbanktabellen werden aus einem gemeinsamen Repeatable-Read-Snapshot exportiert. Dateien werden anschließend gelesen, damit Dateizugriffe die DB-Transaktion nicht verlängern.
- Der Integrationstest ruft den echten Import-Endpunkt auf: Schuljahre, Beziehungen, Abwesenheiten, öffentliche Bilder und private Unterschrift werden wiederhergestellt; importierte Schul-/Lehrkraftkonten bleiben zunächst deaktiviert.
- Ein absichtlich fehlerhafter Import muss Datenbank und Dateien unverändert lassen. Der Test räumt auch importierte UUID-Bilddateien wieder auf.

## Nachweise

- ESLint, TypeScript und Produktions-Build erfolgreich; die UI-Smoke-Tests laufen auch gegen den gebauten Stand.
- Unit-/Regressionstests: 65 bestanden; die vier Datenbanktests werden ohne `TEST_DATABASE_URL` bewusst übersprungen und separat ausgeführt.
- PostgreSQL-Integration: 4/4 bestanden (parallele Zuweisung, echter Backup-Roundtrip mit Fehlimport-Rollback, Bedarfs-Idempotenz mit atomarer Outbox, Outbox-Rollback). Alle 22 Migrationen auf der isolierten Testdatenbank angewendet.
- Echte HTTP-/Browser-Schreibtests: Lehrkraftbearbeitung ohne Passwort, Statuserhalt, Einladung mit gebundener E-Mail, Koordinateneingabe ohne Geocoder, parallele Bedarfswiederholung, geänderter Wiederholungsinhalt, Abwesenheitsvorschau mit zwischenzeitlicher Zuweisung, Änderung mit/ohne aktuelle Vorschau sowie Rückkehr mit Stornierung und Wiederholung.
- UI-Smoke-Tests: Schulamt, Schule, Lehrkraft, Matching, Kartenmodal, Navigation, Logout, Jahreswechsel und Reload, simulierte Profil-/Kerndatenfehler sowie mobile Breiten 390 und 320 Pixel. Screenshots liegen unter `output/ui-audit/` und enthalten nur synthetische Daten.
- `npm audit --omit=dev --audit-level=moderate`: keine gemeldeten Schwachstellen zum Prüfzeitpunkt. Dies ersetzt keinen vollständigen Penetrationstest.

Die Testdatenbank heißt `mobile_reserve_test_20260907_ui`. Die Skripte `scripts/seed-ui-test.ts`, `scripts/check-ui.mjs` und `scripts/check-workflows.mjs` sind ausschließlich für diese isolierte Testumgebung gedacht. Die HTTP-Schreibtests erzeugen synthetische Datensätze; sie sind kein Produktions-Monitoring.

## Vor einem produktiven Rollout

1. Migrationshinweise in `DEPLOYMENT.md` beachten, insbesondere bestehende doppelte Zuweisungen, private Unterschriften und alte Outbox-Nutzdaten. Vorher Datenbank, Dateien und Schlüssel sichern; mit einer geschützten Kopie der konkreten Installation proben.
2. Die neuen Migrationen sind noch nicht in der eigentlichen Anwendungsdatenbank ausgeführt. Ein Versionswechsel muss Anwendung und Datenbankschema zusammen aktualisieren.
3. Echten SMTP-Versand mit der jeweiligen Schulamtskonfiguration sowie Web Push auf echten Zielgeräten unter HTTPS abnehmen. Diese Runde hat absichtlich keine echten Empfänger angeschrieben und keine physischen Geräte gepusht.
4. Externe Karten-/Geocoding-Dienste bleiben eine Betriebsabhängigkeit. Der Fallback und die Fehlermeldungen wurden geprüft, kein Verfügbarkeitsversprechen eines Anbieters.
5. Die Outbox ermöglicht belastbare Wiederholungen, garantiert aber kein absolutes „genau einmal“ über SMTP: ein Absturz unmittelbar nach SMTP-Annahme kann eine erneute Zustellung verursachen. Reset-Token und Reset-Mail sind weiterhin getrennt; bei fehlgeschlagener Aufnahme kann einer der höchstens drei gültigen Tokens unzugestellt bleiben, ohne bestehende Links zu entwerten.

Die acht während früherer Testläufe entstandenen Mini-PNG-Testdateien wurden nach Inhaltsprüfung aus `public/uploads/` in `/private/tmp/mobile-reserve-test-assets-wtL730/` verschoben und sind dort bis zur Betriebssystem-Bereinigung wiederherstellbar. Es wurden keine echten Uploads gelöscht.
