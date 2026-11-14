# Fachregeln und technische Grenzen

Mit dem lokalen Code abgeglichen: 14.11.2026. Nur betroffene Abschnitte lesen; die verlinkten Implementierungen und Tests liefern die Details. Produktänderungen ausdrücklich als solche behandeln und diese Referenz mitpflegen.

## Rollen und Datenzugriff

- Eine Installation verwaltet genau ein Schulamt. `SCHULAMT`, `SCHOOL` und `TEACHER` sind Webrollen; `ADMIN` bleibt nur für Altbestände erhalten.
- Rolle allein reicht nicht: Schule, Lehrkraft, Bedarf und Dateien müssen zur berechtigten Ressource gehören. IDs aus dem Client begründen keinen Zugriff.
- Sitzungen prüfen den aktuellen Kontostand und `sessionVersion`. Deaktivierung, Passwortreset und erzwungener Passwortwechsel dürfen nicht durch alte Cookies umgangen werden.

Quellen: [auth.ts](../src/lib/auth.ts), [webRoles.ts](../src/lib/webRoles.ts), jeweilige API-Route. Tests: [sessionAuth.test.ts](../tests/sessionAuth.test.ts), [webRoles.test.ts](../tests/webRoles.test.ts).

## Kalender und Schuljahre

- Fachliche Kalendertage sind `YYYY-MM-DD` für `Europe/Berlin`; in der Datenbank werden sie kanonisch als UTC-Mitternacht desselben Tages behandelt. Echte Zeitstempel und Kalendertage unterscheiden.
- Vorhandene Datumshelfer verwenden. Ungültige Tage ablehnen; Serverzeitzone und Sommerzeit dürfen keine Einsatztage verschieben.
- Bayerische Ferien (amtlicher Kalender 2024/25 bis einschließlich Sommerferien 2030), landesweite Feiertage und Buß- und Bettag sind für neue Unterrichtszuweisungen gesperrt. Offene Horizonte zählen Unterrichtstage; es gibt keinen Rückfall auf unterrichtsfreie Starttage. Bereits gespeicherte Einsätze bleiben erhalten und erscheinen beim Schulamt zur Prüfung. Unterrichtsfrei bedeutet keine Entscheidung über Dienstpflicht oder Dienstort. Ferientermine vor Planung des Schuljahrs 2030/31 ergänzen. Quelle: [Bayerische Ferienordnung](https://www.verkuendung-bayern.de/baymbl/2022-747/), [Kalenderlogik](../src/lib/schoolCalendar.ts).
- Schuljahr: 1. September bis 31. August; Wochen: Montag bis Sonntag. Für Planung zählt der Einsatzzeitraum, nicht automatisch die heutige Woche.
- Lehrkraftprofile können pro Schuljahr getrennt sein. Jahresübergreifende Abwesenheiten derselben Person müssen weiterhin wirken.

Quellen: [dateKey.ts](../src/lib/dateKey.ts), [schoolYear.ts](../src/lib/schoolYear.ts), [matching.ts](../src/lib/matching.ts), [leaveService.ts](../src/lib/leaveService.ts). Tests: [dateKey.test.ts](../tests/dateKey.test.ts), [matchingCalendarAudit.test.ts](../tests/matchingCalendarAudit.test.ts).

## Bedarf und Zuweisung

- Schulen sehen die Stammschulnamen ihrer zugewiesenen Reserven. Tagesbezogene Stundenänderungen werden als Änderungswunsch gespeichert und erst durch das zuständige Schulamt wirksam. Bestehende Zuweisungen bleiben verbindlich; unpassende Zuweisungen oder aktive Tagesabsagen muss das Schulamt vor Freigabe gesondert bearbeiten. Vergangene Tage und abgeschlossene Bedarfe sind nicht änderbar; offene Wünsche können weiterhin abgelehnt werden. Die JSON-Historie `lessonChanges` bleibt in Sicherungen erhalten.
- Organisatorische Vermerke dürfen meldende Schulen direkt ändern. Schulamt und künftig eingesetzte Reserven erhalten einen Portalhinweis ohne Vermerktext; private Schulnachrichten informieren ausschließlich das Schulamt. Benachrichtigungen werden atomar mit der Änderung eingereiht.
- Eintägige, befristete und offene Bedarfe tageweise auswerten. Offene Bedarfe haben einen beweglichen Planungshorizont; Teilbesetzung lässt Reststunden offen. Tagesabsagen schließen keine anderen Tage.
- Fachliche Eignung, Stammschulbindung, Stundenplan, Abwesenheiten, Schuljahr und Standort gemeinsam berücksichtigen. `onlyStammschule` ist eine Einsatzbeschränkung, kein bloßer Bewertungsbonus.
- Ein Einsatz bindet die Reserve an diesem Tag an Schule und Standort. Weitere Bedarfe am selben Standort sind nur mit eindeutig gespeicherten, überschneidungsfreien Unterrichtsstunden kombinierbar. Fehlende Stundenlage hebt die Sperre nicht auf.
- Automatische Vorschläge halten den Stundenplan ein. Unterstützte manuelle Abweichungen benötigen die vorhandene ausdrückliche Bestätigung; sie setzen keine anderen Sperren außer Kraft.
- Vorschau und Browserzustand ersetzen keine Prüfung beim Speichern. Einzel- und Sammelzuweisung müssen Konflikte auch bei parallelen Anfragen innerhalb der Transaktion absichern.
- Die Einsatzbestätigung umfasst ausschließlich die angezeigten, ausdrücklich ausgewählten IDs. Wiederholung ist idempotent. Bei ausbleibender Rückmeldung gibt die Oberfläche die Bestätigung nach 30 Sekunden wieder frei und lädt den aktuellen Stand nach: Ein Verbindungsabbruch beweist nicht, dass die Speicherung fehlgeschlagen ist.
- Außenstellen sind eigene Einsatzorte. Fehlende Koordinaten nicht stillschweigend durch die Hauptadresse ersetzen; Stammschulbezug bleibt auf Schulebene.

Quellen: [matching.ts](../src/lib/matching.ts), [assignmentBooking.ts](../src/lib/assignmentBooking.ts), [assignService.ts](../src/lib/assignService.ts), [batchPlanning.ts](../src/lib/batchPlanning.ts), [schoolLocations.ts](../src/lib/schoolLocations.ts). Tests: [sameSiteAssignments.integration.test.ts](../tests/sameSiteAssignments.integration.test.ts), [assignmentConcurrency.integration.test.ts](../tests/assignmentConcurrency.integration.test.ts), [batchMatchingInvariants.test.ts](../tests/batchMatchingInvariants.test.ts).

## Stunden, Rückkehr und Nachweise

- Planstunden bleiben erhalten. Gemeldete Ist-Stunden zählen erst nach Freigabe des Schulamts als freigegebene Leistung; fehlende Meldungen bedeuten nicht null geleistete Stunden.
- Unterrichtsstunden und Minuten für zusätzliche Aufgaben getrennt führen. Schulen melden für bestätigte Einsätze ab dem Einsatztag.
- Stornierung, Rückkehr und Abwesenheit dürfen freigegebene Arbeit, offene positive Stundenmeldungen und deren Prüfhistorie nicht beseitigen.
- Gespeicherte Monatsmeldungen sind Stichtagsstände. Spätere Stammdatenänderungen dürfen sie nicht stillschweigend neu berechnen.

Quellen: [assignmentHours.ts](../src/lib/assignmentHours.ts), [assignmentWorkProtection.ts](../src/lib/assignmentWorkProtection.ts), [governmentReport.ts](../src/lib/governmentReport.ts). Tests: [requestLifecycleHours.integration.test.ts](../tests/requestLifecycleHours.integration.test.ts), [assignmentWorkProtection.integration.test.ts](../tests/assignmentWorkProtection.integration.test.ts), [governmentReport.integration.test.ts](../tests/governmentReport.integration.test.ts).

## Datenschutz und Benachrichtigungen

- Lehrkraft-Geokodierung über die PLZ; vollständige Privatanschriften nicht an den Geodienst senden. Manuell gewählte Koordinaten erhalten.
- Private Unterschriften über geschützte Medienzugriffe ausliefern. Öffentliche und private Uploads sowie deren Eigentümer unterscheiden.
- Die bestehende Bereinigung berücksichtigt fachlichen Abschluss, laufende Vorgänge und geschützte Arbeit. Fristen und `BAYTGV_LEGAL_TEXT` nicht beiläufig ändern; Details in den Implementierungen prüfen.
- Fachliche E-Mails über die verschlüsselte Outbox mit der Geschäftstransaktion speichern; Versand und Wiederholung sind davon getrennt. SMTP-Fehler dürfen keinen bereits gespeicherten Vorgang als ungespeichert darstellen.
- Zuweisungs- und Stornierungsmails an Reserven enthalten weder Namen der vertretenen Lehrkraft noch Freitext-Schulhinweise. Empfängerabhängige Inhalte erhalten; Push-Nachrichten bleiben allgemein.
- Aktuell unterstützen die Push-Routen `TEACHER` und `SCHOOL`, nicht `SCHULAMT`. Die ältere Aussage „nur TEACHER“ in `Task.md` beschreibt den heutigen Code nicht.

Quellen: [geocoding.ts](../src/lib/geocoding.ts), [mediaStorage.ts](../src/lib/mediaStorage.ts), [dataRetention.ts](../src/lib/dataRetention.ts), [annualDataRetention.ts](../src/lib/annualDataRetention.ts), [onboarding.ts](../src/lib/onboarding.ts), [emailOutbox.ts](../src/lib/emailOutbox.ts), [assignService.ts](../src/lib/assignService.ts), [Push-Registrierung](../src/app/api/push/subscribe/route.ts). Tests: [privacyRetention.integration.test.ts](../tests/privacyRetention.integration.test.ts), [transactionalOutbox.integration.test.ts](../tests/transactionalOutbox.integration.test.ts), [emailPresentation.test.ts](../tests/emailPresentation.test.ts), [pushRoutes.test.ts](../tests/pushRoutes.test.ts).

## Schema, Sicherung und Exporte

- Schemaänderungen als neue Prisma-Migrationen ablegen; bereits angewendete Migrationen nicht umschreiben. Bestehende Datensätze und alte Sicherungsformate berücksichtigen.
- Bei neuen Feldern und Dateien Sicherung, Wiederherstellung, Schuljahresübernahme und betroffene Exporte mitprüfen.
- JSON-Sicherung, verschlüsseltes Vollbackup und lesbares Schuljahresarchiv erfüllen unterschiedliche Zwecke. Wiederherstellbarkeit nicht allein aus einem erfolgreichen Export ableiten.

Details: [FULL-BACKUP.md](../FULL-BACKUP.md), [SCHULJAHRESARCHIV.md](../SCHULJAHRESARCHIV.md). Tests: [backupRoundTrip.integration.test.ts](../tests/backupRoundTrip.integration.test.ts), [fullBackup.integration.test.ts](../tests/fullBackup.integration.test.ts), [schoolYearArchive.integration.test.ts](../tests/schoolYearArchive.integration.test.ts).
