# Umsetzung und Nachprüfung – 7. September 2026

Grundlage: `AUDIT-2026-09-07-NACHPRUEFUNG.md`, Ausgangscommit `77c26f0f5062ab29f30effa1930dbf06a299669e`.
Die besprochenen Änderungen wurden nach Freigabe umgesetzt. Drei Terra-Agenten bearbeiteten abgegrenzte Pakete; der Hauptagent integrierte, prüfte die Diffs, ergänzte Gegenproben und korrigierte dabei weitere Anschlussfehler.

## Umgesetzte Punkte

| Audit | Umsetzung |
| --- | --- |
| F01 | Gemeinsame unterrichtsstundengenaue Teilzeitprüfung in Einzelmatching, Stapelplanung und verbindlicher Speicherung. |
| F02 | Schuljahreszeilen nach tatsächlichen Einsatztagen auswählen; jahresübergreifende Segmente und passende Datumsauswahl in den Zuweisungsdialogen. Der Stapel-Stichtag begrenzt auch die tatsächlichen Tage. |
| F03, F07 | Stornierte Einsätze getrennt im Verlauf; nächster aktiver Einsatz mit Bestätigungsaktion. Aktualisierung für alle Rollen, einschließlich Fokus/Wiederverbindung und Lehrkraftansicht ohne Push-Abo. |
| F04, F08 | Tagesabwesenheit und Zuweisung konkurrieren serialisierbar mit begrenzten Wiederholungen. UNFILLED muss vor einer Zuweisung wieder geöffnet werden. |
| F05 | Bestätigungs-PDF nur für tatsächlich zugewiesene zusammenhängende Tage und Stunden; keine Übernahme eines offenen oder längeren Bedarfsendes. Stornierte Nachweise eindeutig markiert, ohne grafische Unterschrift. |
| F06 | Öffentliche Angaben in Ersteinrichtung und Schulamt-Einstellungen: Instanzname, Kontakt, Impressum, Datenschutz und eigenes hochgeladenes Behördenlogo. Fehlende Angaben werden angezeigt; Textvorschau vorhanden. |
| F09 | Excel-Export des ausgewählten Schuljahres, eigene Einsatzliste mit Status und null aktiven Stunden bei Stornierungen. Monats-PDF findet die passende Schuljahreszeile derselben Person. |
| F10 | Zentrale Mail-Empfängerauflösung: Login-Adresse, sonst gepflegte Kontaktadresse der Lehrkraft. |
| F11 | Containerbezogene Migrationsanleitung einschließlich privater Unterschriften und neuer Ankunftspunkte. |
| F12 | Eigenes Lehrkraftprofil für vollständige Postanschrift, PLZ, Telefon und Heim-Pin; keine Änderung von Freigabe, Rolle, Stammschule oder Schuljahr möglich. |
| S01 | Bei geänderter SMTP-Zielidentität darf ein maskiertes gespeichertes Passwort nicht weiterverwendet werden; erneute Eingabe erforderlich. Testversand nur mit gespeichertem Stand. |
| S02 | Kleine rollenbezogene Schulverzeichnisantworten. Lehrkräfte bekommen vertraulichere Angaben über den eigenen Einsatz, Schulen ihr eigenes vollständiges Profil. |
| S03 | Lokale und serverseitige Push-Abmeldung unabhängig; sichtbare Wiederholungsmöglichkeit bei Fehlern. Generischer Sperrbildschirmtext ohne Schul-/Personennamen. Fehlgeschlagener Logout darf nach Reload nicht unbemerkt die alte Anmeldung wiederherstellen. |

### Neue Schul-Pins

- Eingang und optionaler Parkplatz sind separate gespeicherte Koordinatenpaare; beide erscheinen in der Anfahrtskarte der zugewiesenen Lehrkraft.
- Maus-/Kartenbedienung und beschriftete Tastatureingabe mit Dezimalkomma. Leere oder unvollständige Eingaben erzeugen keinen Punkt.
- Parkplatz separat entfernen; Eingang nur ohne verbleibenden Parkplatz entfernen.
- Bestehende unklare `pinLat`/`pinLng` bleiben erhalten und müssen bewusst zugeordnet werden, statt automatisch eine neue Bedeutung zu bekommen.
- Allgemeiner Schulstandort bleibt Grundlage der Entfernung; die Ankunftspunkte dienen der Orientierung vor Ort.
- Neue additive Migration: `prisma/migrations/20260907180000_add_school_navigation_points/migration.sql`.
- Backup enthält neue Punkte und öffentliche Instanzangaben samt verifiziertem Logo. Ältere Backups bleiben lesbar; fehlende öffentliche Angaben überschreiben keine bestehenden Werte.

### Bedienung und Design

Login, Profile und Schulansicht wurden an die ruhigere Dashboard-Gestaltung angepasst. Mobile Schulbedarfe erscheinen als Karten. Einstellungen besitzen Abschnittsnavigation, Änderungs-/Speicherstatus und verständliche Ladefehler mit Wiederholung. Ein fehlender Einrichtungsschlüssel stoppt ein nicht abschließbares Produktions-Setup frühzeitig. Jahreswechsel/Übernahme und endgültiges Löschen sind getrennte Abläufe. Stapelfreigaben zeigen eine Zusammenfassung, Outbox-Texte unterscheiden fehlende Inhalte und abgeschlossenen Versand.

Die separate Landingpage beschreibt eine Instanz pro Schulamt, besitzt eine bedienbare mobile Navigation und aktualisierte echte Test-UI-Screenshots. Das vorhandene Produktlogo und die Rubik-Schrift bleiben unverändert. Der feste BayTGV-Text wurde **nicht** inhaltlich geändert.

## Verifikation

- ESLint, TypeScript und Webpack-Produktionsbuild erfolgreich.
- 92 Unit-/Regressionstests bestanden. Die sechs DB-Tests werden im normalen Lauf absichtlich übersprungen und gesondert ausgeführt.
- Alle sechs PostgreSQL-Integrationstests bestanden: parallele Zuweisung, paralleler Tagesausfall, Backup-Roundtrip/Fehlimport-Rollback, Jahres-Export/eigenes Profil/PDF-Rollen, Bedarfs-Idempotenz und transaktionale Outbox.
- 23 Migrationen auf der isolierten Testdatenbank angewendet, keine ausstehend. Das P2002-Protokoll beim absichtlichen Backup-Fehlimport ist Teil des bestandenen Rollback-Tests.
- `scripts/check-ui.mjs`: allgemeiner Browserrundgang einschließlich aller Schulamt-Bereiche und mobiler Ansichten.
- `scripts/check-workflows.mjs`: echte lokale HTTP-/Browserabläufe für Bearbeitung, Einladung, Koordinateneingabe, Idempotenz, Zuweisung, Abwesenheit und Bedarfsende.
- `scripts/check-audit-ui.mjs`: automatische Aktualisierung, Stornierung, ungültige Sitzung, Profil-Ladefehler, Koordinaten/Pin-Speicherung/Teil-PATCH/Entfernen, rollenübergreifende Sichtbarkeit und fehlgeschlagener Logout mit Wiederholung.
- Frische Ersteinrichtung per HTTP sowie vollständiger Headless-Playwright-Wizard auf separaten leeren Testdatenbanken: Pflichtschule, Mail-Skip, neue öffentliche Felder, Abschluss und Anmeldung bestanden. Wiederholbarer Runner: `scripts/check-setup-ui.mjs`.
- `scripts/check-landing.mjs`: Desktop, 390 und 320 Pixel, Navigation per Tastatur und kein horizontaler Seitenüberlauf.
- `scripts/render-proof-fixtures.ts`: synthetische PDF-Beispiele für Einzel-/Serieneinsatz, Stornierung und lange Behördenangaben. Alle sechs finalen Seiten mit Poppler gerendert und vom Hauptagenten visuell geprüft. Normale Einzel-/Zweitagesnachweise einseitig; lange Inhalte und Stornierungen sauber umbrochen.
- PDF-Rollenprüfung am echten Route-Handler: anonym 401, Schule/fremde Lehrkraft 403, eigene Lehrkraft und zuständiges Schulamt 200; keine öffentliche Zwischenspeicherung.

## Bewusste Grenzen und verbleibende Betriebsabnahme

1. **Kein vollständiger Produktions- oder Penetrationstest.** Echter SMTP-Versand, physischer Handy-Push mit Offline/Wiederverbindung, Docker-Neuinstallation und reale Upgrade-/Lasttests stehen weiterhin aus. Dafür wurden keine realen Zugangsdaten oder externen Angriffstests verwendet.
2. **Keine rechtliche Freigabe.** Betreiberinformationen müssen von der zuständigen Stelle geprüft werden. Die Software erfindet dafür keine rechtsverbindlichen Texte.
3. **Teilbesetzungen:** `Assignment` speichert eine Stundenzahl, aber keine einzelnen Unterrichtsstunden. Deshalb wird bei Teilzeit konservativ die Verfügbarkeit im gesamten angefragten Stundenblock verlangt; beliebige Teilblöcke werden nicht behauptet.
4. **Ungespeicherte Änderungen:** Schutz bei Reload/Verlassen, Links und bekannten programmatischen Navigationen/Logout. Browser-Zurück/Vor innerhalb der SPA wird nicht mit manipulativen History-Tricks blockiert; vor diesem Wechsel bitte speichern. Keine Behauptung eines lückenlosen Navigation-Guards.
5. **Push-Abmeldung bei Totalausfall:** Ein Browser-/Netzausfall kann eine Bereinigung verhindern. Die App warnt und bietet Wiederholung; auf gemeinsam genutzten Geräten ggf. zusätzlich die Benachrichtigungsberechtigung im Browser entfernen. E-Mail-Benachrichtigungen bleiben ein separater Kanal für die vorgesehenen Empfänger.

## Arbeitsstand

Ausschließlich synthetische lokale Datenbanken (`mobile_reserve_test_20260907_ui`, `mobile_reserve_test_20260907_setup`, `mobile_reserve_test_20260907_setup_browser`) verwendet. Die Produktionsdatenbank wurde nicht verändert. Testbilder und Laufzeit-Uploads sind vom Git-Tracking ausgeschlossen; nichts davon wurde gelöscht.

Die Änderungen dieser Umsetzungsrunde liegen im lokalen Arbeitsbaum. Es wurde dafür noch kein neuer Commit/Push und kein produktives Deployment durchgeführt.
