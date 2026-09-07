# Unabhängige Nachprüfung: Funktion, Workflows, Sicherheit und UI

Stand: Commit `77c26f0f5062ab29f30effa1930dbf06a299669e`, 7. September 2026.

## Ergebnis

**Noch keine uneingeschränkte Rollout-Empfehlung.** Die vorhandenen Tests sind grün, decken aber mehrere relevante Randfälle und Bedienungsprobleme nicht ab. Die folgenden Punkte sind Analyse und Umsetzungsvorschläge, keine bereits ausgeführten Korrekturen. Anwendungscode, produktive Datenbank und Git-Remote wurden in dieser Nachprüfung nicht geändert.

Der Hauptagent hat den laufenden Produktions-Build mit synthetischen Daten selbst im Browser durchgesehen und Befunde anhand des Codes nachgeprüft. Drei Terra-Agenten untersuchten unabhängig Sicherheit, Fachlogik sowie Betrieb/Performance. Agentenbewertungen wurden nicht ungeprüft übernommen; insbesondere setzt das SMTP-Thema bereits Schulamtsrechte voraus und ist deshalb kein anonymer Kontoeinbruch.

## Prüfungen und Grenzen

- Erneut 65 Unit-/Regressionstests bestanden; vier DB-Tests im normalen Lauf erwartungsgemäß übersprungen. Anschließend alle vier PostgreSQL-Integrationstests separat bestanden, 22 Migrationen vorhanden, keine ausstehend. Der protokollierte absichtliche Backup-Fehlimport mit P2002 gehört zum bestandenen Rollback-Test.
- Eigener Browserrundgang: Anmeldung, Schulamtsübersicht, Berechnung der Idealbesetzung ohne Freigabe, Reservenliste, Einladungs- und Übernahmedialog, Schulen, Statistik, Dokumentation, Einstellungen, Logout, öffentliche Betreiberinformationen, Passwort-Hilfe ohne Versand, Lehrkraft-Dashboard und beide Abwesenheitsdialoge, Schul-Dashboard mit ein-/mehrtägigem Formular sowie Schulprofil. Desktopdarstellung und mobile Navigation wurden betrachtet.
- Lesende HTTP-Rollenprüfung an der Testinstanz: Bestätigungs-PDF liefert anonym 401, eigener Lehrkraft 200, Schule 403, Schulamt 200. Schule und Lehrkraft erhalten über `/api/schools` jeweils alle drei synthetischen Schulen einschließlich Hinweise. Öffentliche Einstellungen der Testinstanz sind leer.
- Ausführbare, DB-freie Gegenproben mit der echten Fachlogik und gemockten Transaktionen bestätigen unzulässige Teilzeitvorschläge und die fehlende UNFILLED-Sperre. Eine deterministische Gegenprobe bestätigt, dass offene August-Bedarfe im September aktuelle Bedarfstage enthalten, während die Kandidatenauswahl das Vorjahr verwendet.
- Frische Ersteinrichtung und die separate Werbeseite `landing/` wurden in dieser Runde im Code untersucht, nicht nochmals vollständig in einer leeren Instanz eingerichtet bzw. visuell in allen Breiten abgenommen. Physischer Handy-Push, echter SMTP-Versand, Docker-Build, Lasttest und Migration einer realen Installation bleiben offen. Dies ist kein vollständiger Penetrationstest und keine rechtliche Freigabe.
- Ausschließlich isolierte Testdatenbank `mobile_reserve_test_20260907_ui`, Testkonten mit `@ui-test.local`, lokale Testinstanz auf Port 3117. Automatische Outbox- und Bereinigungsscheduler dort ausgeschaltet.

## Vor dem Rollout beheben

### F01 – P1: Idealbesetzung und harte Zuweisung beachten Teilzeit-Unterrichtszeiten nicht ausreichend

**Dateien:** `src/lib/batchMatching.ts:173`, `src/lib/assignService.ts:230`, Referenz `src/lib/matching.ts:318`.

Die Stapelplanung vergleicht nur die Zahl verfügbarer Stunden. Der gemeinsame Speicherpfad prüft den Teilzeitstundenplan gar nicht. Gegenprobe: Lehrkraft montags ausschließlich in Stunde 1 verfügbar, Bedarf montags in Stunde 5. Stapelvorschlag besetzt ihn; der gemeinsame Validator lässt die Speicherung zu.

**Lösung:** Eine gemeinsame tages- und unterrichtsstundengenaue Verfügbarkeitsprüfung für Einzelmatching, Stapelmatching und verbindliche Speicherung. Zulässige Mehrarbeit ausdrücklich von nicht verfügbaren Unterrichtszeiten unterscheiden.

**Akzeptanz:** Dieser Fall wird weder vorgeschlagen noch gespeichert; passend überlappende Stunden funktionieren. Tests für lückenhafte Stundenpläne, verschiedene Wochentage und Teilbesetzung ergänzen.

### F02 – P1: Über den Schuljahreswechsel laufende Bedarfe verwenden das falsche Kandidatenjahr

**Dateien:** `src/app/api/match/[requestId]/route.ts:33`, `src/app/api/batch-assign/preview/route.ts:61`, `src/lib/batchMatching.ts:237`, `src/lib/assignService.ts:241`.

Kandidaten werden nach dem Startdatum des Bedarfs geladen. Ein noch offener Bedarf ab 31. August benötigt im September aber aktuelle Schuljahreszeilen. Diese fehlen; Vorschläge mit Vorjahreszeilen scheitern anschließend an der korrekten Jahresprüfung beim Speichern.

**Lösung:** Kandidaten und Vorschlagssegmente nach den tatsächlich zu besetzenden Tagen bzw. Schuljahren aufteilen. Personenidentität über die Jahreszeilen erhalten.

**Akzeptanz:** Offener August-Bedarf ist im September mit aktuellen Reserven besetzbar; ein begrenzter jahresübergreifender Zeitraum wird korrekt aufgeteilt. Keine Doppelzuweisung derselben Person.

### F03 – P1: Stornierter Einsatz erscheint als nächster Einsatz

**Dateien:** `src/app/api/teachers/[id]/assignments/route.ts:32`, `src/components/TeacherDashboard.tsx:258`, `src/components/teacher/TeacherNextAssignment.tsx:15`.

Der Endpunkt liefert auch REJECTED-Zuweisungen. Die Auswahl des nächsten Einsatzes filtert nur nach Datum. Die Hauptkarte zeigt für REJECTED keinen Stornierungshinweis, aber Schule, Termin und Anfahrt. Ein tatsächlich anstehender Einsatz kann dadurch in die Nebenliste rutschen und seine vorrangige Bestätigungsaktion verlieren.

**Lösung:** Aktive nächste Einsätze von stornierten Vorgängen trennen; Stornierungen ausdrücklich gekennzeichnet in einem Verlauf behalten.

**Akzeptanz:** Stornierung morgen plus aktiver Einsatz übermorgen zeigt übermorgen als nächsten Einsatz; keine irreführende Bestätigung oder Anfahrt für die Stornierung.

### F04 – P1: Einmalige Tagesabwesenheit kann mit einer parallelen Zuweisung kollidieren

**Datei:** `src/app/api/teachers/absence/route.ts:51` und `:67`.

Betroffene Zuweisungen werden vor der Transaktion gelesen. Innerhalb der Transaktion werden nur diese vorher gelesenen IDs storniert. Eine zwischenzeitlich neu angelegte Zuweisung kann daher aktiv bleiben, obwohl die Tagesabwesenheit gespeichert ist. Befund aus der konkreten Transaktionsreihenfolge; dieser spezielle Wettlauf wurde noch nicht durch einen synchronisierten DB-Test ausgeführt.

**Lösung:** Lesen, Abwesenheit, Stornierungen und Mailaufträge in eine mit der Zuweisung kompatible atomare Konkurrenzkontrolle aufnehmen; Konflikte gezielt wiederholen oder verständlich zurückgeben.

**Akzeptanz:** Deterministischer Integrationstest mit Synchronisationsbarrieren: niemals gleichzeitig Tagesabwesenheit und aktive Zuweisung für dieselbe Person und denselben Tag.

### F05 – P1: Bestätigungs-PDF kann einen zu langen Einsatzzeitraum bescheinigen

**Datei:** `src/app/api/assignments/[id]/pdf/route.ts:84` und `:195`.

Der Download gehört zu einer einzelnen Zuweisung, übernimmt das Ende aber vom gesamten Bedarf. Wer nur einen Tag eines mehrtägigen Bedarfs übernimmt, erhält somit einen längeren Zeitraum; bei offenem Bedarf sogar „Ende offen“. Zusätzlich fehlt eine Statusprüfung für stornierte Zuweisungen.

**Lösung:** Fachlich festlegen, ob das Dokument einen einzelnen Einsatz oder eine zusammenhängende, tatsächlich zugewiesene Serie bescheinigt. Nur genau diese Tage/Stunden ausgeben. Stornierte Vorgänge blockieren oder deutlich als storniert darstellen. Der verbindliche BayTGV-Text bleibt unverändert.

**Akzeptanz:** Ein Tag aus einem Fünf-Tage-Bedarf wird als genau ein Tag bescheinigt. Unterbrochene Serien, offene Bedarfe und Stornierungen sind korrekt. Inhalt und Seitenlayout anschließend mit gerenderten PDFs abnehmen.

### F06 – P1 für Neuinstallationen: Editor für öffentliche Betreiberinformationen entfernt

**Dateien:** `src/components/auth/ImpressumDialog.tsx:32`, `src/app/api/settings/route.ts:35`, `src/app/api/setup/register/route.ts:92`, gelöschte `src/components/AdminDashboard.tsx`.

Mit dem technischen Admin verschwand auch der einzige normale Editor für `impressum`, `privacyPolicy`, `loginLogoUrl` und `loginLogoAlt`. Die lesenden Komponenten und die Schulamt-API bestehen weiter; Setup und Schulamt-Einstellungen bieten dafür aber keine Eingabemaske. Im eigenen Browserrundgang: „Kein Impressum hinterlegt“ und „Keine Datenschutzerklärung hinterlegt“. Der vorhandene Entwickler-Seeder ist kein unterstützter Installationsweg.

**Lösung:** Instanzangaben in Setup und Schulamt-Einstellungen übernehmen, öffentliche Vorschau und Vollständigkeitshinweis anbieten. Betreibertexte müssen von der zuständigen Stelle geliefert/freigegeben werden; keine pauschale rechtliche Zusicherung durch Softwaretexte.

**Akzeptanz:** Neue Instanz kann die Angaben ohne SQL/API-Handarbeit vollständig hinterlegen und später ändern. Startseite zeigt die gespeicherten Texte und das konfigurierte zusätzliche Behördenlogo.

## Weitere konkrete Korrekturen

### F07 – P2: Lehrkraft-Dashboard aktualisiert sich nicht automatisch

`src/components/AutoRefresh.tsx:10` schließt TEACHER aus; `src/components/TeacherDashboard.tsx:246` wartet trotzdem auf `app-refresh`. Auch der Service Worker fokussiert beim Notification-Klick nur das Fenster. Vorschlag: sichtbarkeitsabhängige Aktualisierung für alle Rollen, Fokus-/Wiederverbindungsrefresh und sichtbarer Stand mit manueller Alternative. E-Mail, Web-Push und Aktualisieren sind getrennte Funktionen. Test: Schulamt weist zu/storniert, offene Lehrkraftansicht übernimmt den neuen Stand ohne Neuladen und ohne aktiviertes Push-Abo.

### F08 – P2: Als unbesetzbar markierter Bedarf kann trotzdem zugewiesen werden

`src/lib/assignService.ts:203` prüft den Bedarfsstatus nicht; `src/lib/leaveService.ts:40` belässt UNFILLED unverändert. DB-freie Gegenprobe lässt eine Zuweisung zu, während der Bedarf UNFILLED bleibt. Vorschlag: Statusübergang ausdrücklich festlegen – erst wieder öffnen oder atomar in einen besetzbaren Zustand wechseln. Test: kein aktiver Einsatz bei unverändertem UNFILLED-Status; direkte API und Stapelfreigabe müssen dieselbe Regel verwenden.

### F09 – P2: Jahresexport enthält alle Jahre und stornierte Einsätze ohne entsprechende Kennzeichnung

`src/components/schulamt/DocumentationPanel.tsx:76` verspricht Daten dieses Schuljahres; `src/app/api/export/route.ts:27` hat keinen Jahresfilter. Alle Zuweisungen gehen ohne Statusfilter bzw. Statusspalte in die Einsatzliste ein (`:66`). Außerdem heißt der Knopf CSV, geliefert wird XLSX. Vorschlag: ausgewähltes Schuljahr explizit übergeben, Einsatzstatus/Abrechnungsregel definieren, Format korrekt benennen. Tests mit zwei Jahren und stornierten Einsätzen.

### F10 – P2: Kontakt-Lehrkräfte ohne Login erhalten nicht alle Einsatzmails

`src/lib/assignService.ts:382` verwendet nur `teacher.user?.email`, obwohl `Teacher.email` für Benachrichtigungen existiert. Andere Versandpfade nutzen dieses Feld. Vorschlag: zentrale Empfängerauflösung mit dokumentierter Priorität und Dublettenvermeidung. Test für aktive Kontakt-Lehrkraft ohne User-Konto, einschließlich Zuweisung und Stornierung.

### F11 – P2: Migrationsanleitung passt nicht zum dokumentierten Docker-Installationsweg

`DEPLOYMENT.md:150` provisioniert Compose und `.env`, nicht den Quellcode. `:366` fordert dann Host-Aufrufe von Prisma und `scripts/migrate-private-signatures.mjs`. Diese liegen laut `Dockerfile:47` nur im Container. Vorschlag: durchgängige Containerbefehle mit korrektem Service und gemounteten Volumes, Reihenfolge zur automatischen Startmigration beachten. Test auf frischer Compose-Installation ohne Source-Checkout, danach bestehende private Unterschriften prüfen. Lokaler Docker-Test weiterhin ausstehend.

### F12 – P2: Lehrkraft kann ihren Wohnort-Pin nach Registrierung nicht selbst korrigieren

`PostalCodeLocationPicker` wird bei Registrierung sowie durch Schulamt-Dialoge verwendet. `src/app/api/teachers/[id]/route.ts:15` erlaubt Änderungen nur dem Schulamt; die Lehrkraftansicht hat keinen Profilbereich. Das deckt Selbstkorrektur bei Umzug oder falsch gesetztem Pin nicht ab. Vorschlag: eng begrenztes eigenes Profil für Anschrift/PLZ/Wohnort-Pin, ohne Freigabe-, Schuljahres- oder Stammschulrechte zu erweitern. Test: eigener Pin aktualisiert Matching und Schulamtsansicht; fremde Profile bleiben unzugänglich.

## Sicherheitsbefunde und Härtung

### S01 – P2: Maskiertes SMTP-Passwort wird bei Hostwechsel wiederverwendet

`src/app/api/schulamt/profile/route.ts:148` behält bei `********` das bestehende Geheimnis und speichert gleichzeitig frei veränderte Host-/Benutzerdaten. Der Testversand verwendet das Geheimnis gegen dieses neue Ziel (`src/lib/email.ts:101`). Voraussetzung sind bereits volle SCHULAMT-Rechte; keine anonyme Lücke. Vorschlag: bei Änderung der SMTP-Zielidentität Passwort erneut verlangen bzw. gesondert bestätigen. Interne SMTP-Server können legitim sein und dürfen nicht pauschal ausgeschlossen werden. Kein echter fremder Mailserver oder echtes Passwort wurde für den Audit angesprochen.

### S02 – P2: Schulverzeichnis gibt mehr betriebliche Angaben zurück als nötig

`src/app/api/schools/route.ts:20` liefert Schulen und Lehrkräften alle Schulen des Schulamts inklusive freier Hinweise und Anfahrtsinformationen. Lesender Test mit Testkonten bestätigt drei von drei Schulen samt Hinweisen. Schulnamen/Standorte können öffentlich sein; problematisch ist die pauschale Weitergabe der gesamten Betriebsinformationen ohne Einsatzbezug. Vorschlag: kleine Verzeichnisdarstellung von vertraulicheren Profil-/Einsatzdetails trennen, Zugriffsmodell je Rolle festlegen und testen.

### S03 – P2: Fehlgeschlagene Push-Abmeldung wird nur protokolliert

`src/components/AuthProvider.tsx:130` behandelt Fehler vor der lokalen Push-Abmeldung gemeinsam; schlägt der Serveraufruf fehl, kann auch das nachfolgende lokale `unsubscribe()` ausfallen. Verbleibende Abos können Schulnamen auf gemeinsam genutzten Geräten anzeigen (`public/sw.js:13`). Vorschlag: lokale und serverseitige Bereinigung unabhängig versuchen, fehlgeschlagene Abmeldung verständlich anzeigen und Benachrichtigungsinhalt auf dem Sperrbildschirm minimieren. Physischer Offline-/Wiederverbindungstest ausstehend; keine Zusage vollständiger Push-Abnahme.

**Positiv bestätigt:** PDF-Rollenabgrenzung; private Unterschriften mit Eigentumsbezug; Tokenablauf und Einmaligkeit im Code; DB-gestützte Session-/Versionsprüfung; abgesicherte Push-Zielprüfung; verschlüsselte Outbox mit Leases; transaktionaler Backup-Rollback. Das ersetzt nicht die oben genannten gezielten Ergänzungen.

## Design, Startseite und Bedienbarkeit

1. **Gemeinsames Design ist erst teilweise durchgezogen.** Schul- und Lehrkraft-Dashboard haben die ruhigeren Karten/Abstände. Schulprofil (`src/app/schule/profil/page.tsx:165`) und Login (`src/components/LoginScreen.tsx:124`) verwenden noch Glaseffekte, stärkere Schatten und andere Hervorhebungen. Empfehlung: gemeinsame Seitentitel, Karten, Abstände und Aktionshierarchie; vorhandenes Logo und Rubik als Wiedererkennung beibehalten.
2. **Startseite muss die konkrete Instanz erklären.** Unter dem Produktlogo Schulamtsname, kurze Zugangs-/Einladungshilfe und zuständigen Kontakt anzeigen. Ein gemeinsames Login für alle Rollen bleibt sinnvoll; keine funktionslose Rollenauswahl. Passwort anzeigen/verbergen und verständliche Fehler-/Ladezustände ergänzen. Öffentliche Betreiberinformationen gemäß F06 wieder konfigurierbar machen.
3. **„Neues Schuljahr“ darf keine Löschaktion als normalen Jahreswechsel darstellen.** `DocumentationPanel.tsx` und Schulprofil bewerben Löschung zum Jahresende. Jahresauswahl/Übernahme in einen eigenen begleiteten Ablauf, endgültige Bereinigung getrennt in eine klar beschriftete Gefahrenzone verschieben; Reichweite und Sicherung vor Bestätigung anzeigen. Keine Löschung im Audit ausgeführt.
4. **Große Einstellungen aufteilen:** Behördenangaben, Dokumente/Vorschau, Mail/Einladungen, Betrieb/Updates. Datenverlust bei Navigation erkennen; gespeicherten Zustand und offene Änderungen unterscheiden.
5. **Idealbesetzung verständlicher:** Auswahl-/Abdeckungszähler eindeutig benennen, konkrete Tage/Unterrichtsstunden zeigen und vor „Freigeben“ eine kompakte Zusammenfassung bieten. Aktuell erscheinen z.B. „11 von 14 Anforderungen“ und „12 von 12 ausgewählt“ nebeneinander, ohne die unterschiedlichen Zählgrößen zu erklären.
6. **Mobile Schulbedarfe als kompakte Karten prüfen:** Die breite Tabelle verlangt horizontales Scrollen. Status, Zeitraum, zugewiesene Person und nächste Aktion sollten auf kleinen Displays zusammen sichtbar sein. Tabellenüberschriften bereinigen (u.a. Schulart/Qualifikation/Klasse).
7. **Barrierefreiheit durchgängig statt nur im Registrierungsdialog:** Der Kartenbaustein verspricht Koordinatenfelder, die das Schulprofil nicht anbietet (`LocationPickerMap.tsx:131`, `schule/profil/page.tsx:231`). Alternative Tastatur-/Koordinateneingabe wirklich bereitstellen; eindeutige Markernamen und deutsche Dialogschließbeschriftung statt „Close“. Eine formale vollständige Barrierefreiheitsabnahme steht aus.
8. **Blockiertes Setup früh stoppen:** Fehlt SETUP_TOKEN in Produktion, warnt der Wizard zwar, lässt aber die Schritte weiter bearbeiten und sperrt erst den Abschluss (`InitialSetupWizard.tsx:288`, `:377`). Stattdessen sofort eine klare Betriebsanweisung anzeigen; kein langes Ausfüllen eines nicht abschließbaren Formulars.
9. **Outbox-Texte genauer:** Bei fehlendem Nutzinhalt steht auch für fehlgeschlagene Aufträge „Inhalt nach Versand gelöscht“. Das suggeriert einen Versand. Erfolgreich gelöscht, nicht gespeichert und fehlgeschlagen sprachlich trennen; deaktivierten Versand als bewussten Konfigurationszustand behandeln.
10. **Separate öffentliche Werbeseite:** `landing/` ist nicht die App-Startseite und wird nicht mit dem App-Image ausgeliefert. Die dortige Mandantenbehauptung (`landing/index.html:158`) passt nicht mehr zu einer Instanz pro Schulamt. Screenshots nach finaler UI-Abnahme erneuern. Mobile Navigation fehlt unter 820px; das nicht umbrechende Marken-/CTA-Layout ist bei 320px gesondert visuell auf Überlauf zu prüfen. Pauschale Rechts-/Konformitätsversprechen nicht ungeprüft übernehmen.

## Neue Nutzeranforderung: Eingang und Parkplatz getrennt markieren

**Ziel:** Zwei unabhängig setzbare, klar unterscheidbare Pins im Schulprofil und in der Anfahrtsansicht der zugewiesenen Lehrkraft.

**Vorschlag:** Eingang und optionaler Parkplatz mit unterschiedlichen Symbolen, Legende, aktivem Auswahlmodus und beschrifteten Koordinatenfeldern. Parkplatz kann bewusst entfernt werden, ohne Eingang zu verlieren. Der allgemeine Schulstandort bleibt Grundlage der Entfernungsberechnung, die zwei Zusatzpins dienen der konkreten Anfahrt.

**Betroffene Bereiche:** `prisma/schema.prisma`, neue additive Migration, `src/app/api/schools/route.ts`, `src/app/schule/profil/page.tsx`, `src/components/LocationPickerMap.tsx`, `src/components/AssignmentMap.tsx`, `src/components/AssignmentMapWrapper.tsx`, `src/types/models.ts`, `src/lib/backup.ts`, Backup-Import/Export und deren Tests.

**Migration fachlich klären:** Der alte `pinLat`/`pinLng` ist ausdrücklich „Eingang / Parkplatz“ und damit nicht eindeutig. Nicht stillschweigend als Eingang umetikettieren. Bestehende Position erhalten und zur Zuordnung auffordern; keine koordinatenlosen Fallback-Marker als echte gespeicherte Position ausgeben.

**Akzeptanz:** Beide Pins separat setzen/ändern/löschen, Maus und Tastatur, beide gleichzeitig bei der Mobile sichtbar, verständlich bei fehlendem Parkplatz; Backup-Roundtrip und Altdatenmigration verlustfrei. Bestehende Rollenrechte bleiben bestehen.

## Empfohlene kleine Aufgabenblöcke nach Besprechung

1. F01: gemeinsame Stundenplanprüfung mit Regressionstests.
2. F02: jahresübergreifende Kandidaten/Segmente.
3. F03 + F07: richtige und aktuelle Lehrkraft-Einsatzansicht.
4. F04 + F08: atomare Statusübergänge und Konkurrenztest.
5. F05 + F09: korrekte Nachweise und Exporte, einschließlich visueller PDF-Abnahme.
6. F06 + Setup-Blockierung: vollständige Instanzeinrichtung ohne technischen Admin.
7. F10 + S01 + S03: getrennte, kleine Mail-/Push-Korrekturen mit jeweils eigenen Tests.
8. F11 + S02: Betriebsanleitung und Rollen-Datenminimierung.
9. Zwei Schul-Pins mit klarer Migration; danach Lehrkraft-Selbstkorrektur F12.
10. Designkonsistenz, mobile Listen und Startseite; anschließend separater Landing-Abgleich.

Jeder Block erhält erst einen konkreten Plan, dann Umsetzung nach Freigabe, Tests und einen separat prüfbaren Diff. Kein Sammelauftrag „alles ändern“ an Gemini oder einen Unteragenten.
