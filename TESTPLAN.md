# Testplan & Rollenabläufe (Rollout Audit Hardening)

Dieser Testplan dokumentiert die manuellen und automatisierten Rollenabläufe zur Verifikation der gehärteten Anwendung für den schulamtsspezifischen Rollout in Bayern.

---

## Übersicht der Testabdeckung

| Bereich | Automatisierte Tests | Manuelle Rollentests |
|---|---|---|
| Datumsnormalisierung & Validierung | `tests/dateKey.test.ts`, `tests/requestValidation.test.ts` | Ablauf 3, 5, 8 |
| Statusberechnung & Bedarfstage | `tests/requestStatus.test.ts` | Ablauf 8, 9, 10, 11, 12 |
| DSGVO-Aufbewahrungsfristen | `tests/dataRetention.test.ts` | Ablauf 12, 15 |
| Backup & Restore v2.0 | `tests/backupRoundTrip.test.ts` | Ablauf 15 |
| Updateprüfung (SemVer) | `tests/updateCheck.test.ts` | Ablauf 17 |
| Zuweisungs-Konkurrenz (P2002/P2034) | `tests/assignmentConcurrency.integration.test.ts` | Ablauf 9, 10 |
| Webrollen & Ressourcen-Autorisierung | `tests/webRoles.test.ts`, Rollenmatrix | Ablauf 2, 13 |

---

## Manuelle Rollenabläufe

### 1. Erstinstallation (Startseite `/` bei leerer Datenbank)
* **Rolle**: Systembetreuer / Erstnutzer
* **Schritte**:
  1. Aufruf von `/` bei leerer Datenbank.
  2. „Zugang“: Name, E-Mail und Passwort des einzigen Schulamts erfassen.
  3. „Dokumente“: Briefkopf, Amtsleitung, Logo (PNG/JPEG) und Unterschrift erfassen.
  4. „Schulen“: Mindestens 1 Schule eingeben (`min(1)` Pflicht). Adresse erfassen oder manuell Koordinaten setzen.
  5. „Mail“: SMTP vollständig einrichten oder ausdrücklich auf später verschieben.
  6. „Prüfen“: Schulamts- und Schulzugänge anlegen und zur Anmeldung wechseln.
* **Erwartetes Ergebnis**:
  - Validierung verhindert Weitergehen ohne mindestens eine Schule.
  - Unterschrift wird sicher unter `private-uploads/signatures/` gespeichert.
  - Falls Nominatim nicht erreichbar ist, wird die Schule mit `PENDING` angelegt, die Einrichtung bricht nicht ab.

### 2. Einzelinstanz und technische Kontowiederherstellung
* **Rolle**: Serverbetreuung
* **Schritte**:
  1. Prüfen, dass ein historisches `ADMIN`-Konto sich nicht an der Weboberfläche anmelden kann.
  2. Prüfen, dass `/api/admin/schulaemter` für alle Methoden mit HTTP 410 antwortet.
  3. In einer Testinstanz `node scripts/recover-schulamt-account.mjs` interaktiv starten.
* **Erwartetes Ergebnis**:
  - Pro Installation existiert genau ein regulär nutzbares Schulamtskonto.
  - Es gibt kein technisches Admin-Dashboard und keinen Webweg zum Anlegen weiterer Schulämter.
  - Das Recovery-Skript arbeitet nur im TTY, verlangt eine Bestätigungsphrase sowie doppelte Passworteingabe und verweigert Instanzen mit nicht genau einem Schulamtskonto.

### 3. Schule: Bedarfsanforderung & Schulart
* **Rolle**: `SCHOOL` (z. B. Mittelschule)
* **Schritte**:
  1. Anmelden als Schule.
  2. Formular "Neue Vertretung anfordern" öffnen.
  3. Ein- oder mehrtägigen Zeitraum wählen (z. B. 5 Tage), Stundenbedarf je Tag erfassen.
* **Erwartetes Ergebnis**:
  - `schoolType` wird serverseitig unveränderbar aus dem Schul-Datensatz ermittelt (`MITTELSCHULE` bleibt `MITTELSCHULE`).
  - Ungültige Kalenderdaten (`2026-02-31`) oder Enddaten vor dem Startdatum werden per HTTP 400 abgewiesen.
  - Zeiträume über 400 Kalendertage werden abgelehnt.

### 4. Mobile Reserve: Übersicht, Push & Selbstmeldung
* **Rolle**: `TEACHER`
* **Schritte**:
  1. Anmelden als Mobile Reserve.
  2. Push-Benachrichtigungen im Browser aktivieren.
  3. Den Schalter "Heute krank / abwesend" betätigen.
* **Erwartetes Ergebnis**:
  - Web-Push-Subscription wird serverseitig typisiert gespeichert.
  - Begrüßungs-Push wird zugestellt.
  - Abwesenheitsmeldung erzeugt einen tagesgenauen `Absence`-Eintrag für den aktuellen Tag; betroffene Zuweisungen werden storniert und Bedarfe auf `PARTIALLY_FILLED` / `PENDING` zurückgerechnet.

### 5. Einladung & Erneuerung von Lehrkräften
* **Rolle**: `SCHULAMT`
* **Schritte**:
  1. Im Menü "Mobile Reserven" auf "Lehrkraft einladen" klicken.
  2. E-Mail-Adresse und Gültigkeit (1–90 Tage) angeben.
  3. Einladung absenden. Nach Ablauf oder auf Wunsch "Einladung erneuern" klicken.
* **Erwartetes Ergebnis**:
  - Der Link wird in Produktion ausschließlich über `NEXT_PUBLIC_APP_URL` gebildet.
  - Vorheriger Token wird beim Erneuern atomar invalidiert.
  - Nach Annahme der Einladung ist der Link nicht mehr erneuerbar.

### 6. Schuljahresübernahme
* **Rolle**: `SCHULAMT`
* **Schritte**:
  1. Im Header das Ziel-Schuljahr auswählen (z. B. `2026/2027`).
  2. Dialog "Lehrkräfte aus dem Vorjahr übernehmen" aufrufen.
  3. Übernahme bestätigen.
* **Erwartetes Ergebnis**:
  - Aktive Lehrkräfte werden ins neue Schuljahr kopiert.
  - Personenbezogene Langzeitabwesenheiten (`userId`) bleiben über Schuljahresgrenzen hinweg synchron und wirksam.

### 7. Kartenpin & Entfernungsmessung
* **Rolle**: `TEACHER` / `SCHULAMT`
* **Schritte**:
  1. Lehrkraft setzt in ihrem Profil den exakten Wohnort-Pin auf der Karte.
  2. Schulamt prüft die Distanzanzeige im Matching.
* **Erwartetes Ergebnis**:
  - An Nominatim wird aus Datenschutzgründen nur die 5-stellige PLZ übertragen.
  - Der exakte Pin bleibt intern für die Entfernungsberechnung gespeichert.
  - Koordinaten tauchen in keinem exportierten Abordnungs-PDF auf.

### 8. Ein- und mehrtägiger Bedarf
* **Rolle**: `SCHULAMT` / `SCHOOL`
* **Schritte**:
  1. Schule legt einen 10-Tage-Bedarf an.
  2. Schulamt weist eine Lehrkraft für die ersten 5 Tage zu.
  3. Statusanzeige prüfen.
* **Erwartetes Ergebnis**:
  - Der Bedarf wechselt auf `PARTIALLY_FILLED`.
  - Erst wenn alle 10 Schultage vollständig besetzt sind, wechselt der Status auf `FILLED`.

### 9. Idealbesetzung (Matching-Algorithmus)
* **Rolle**: `SCHULAMT`
* **Schritte**:
  1. Menüpunkt "Idealbesetzung" aufrufen.
  2. Vorschläge prüfen: Stammschulbonus, Qualifikation, Entfernung, Auslastung.
* **Erwartetes Ergebnis**:
  - Lehrkräfte mit tagesaktueller Abwesenheit oder Langzeitabwesenheit (`userId`) werden nicht vorgeschlagen.
  - Keine Duplikate bei mehreren Schuljahreszeilen derselben Person.

### 10. Bestätigung der Zuweisung (atomare Transaktion)
* **Rolle**: `SCHULAMT` / `TEACHER`
* **Schritte**:
  1. Zuweisung vornehmen.
  2. Gleichzeitige Stornierung und Bestätigung simulieren.
* **Erwartetes Ergebnis**:
  - Transaktion mit `Serializable`-Isolation verhindert Doppelbuchung.
  - Eine gleichzeitig stornierte Zuweisung kann nicht mehr bestätigt werden (HTTP 409).

### 11. Ausfallmeldung / Stornierung
* **Rolle**: `SCHULAMT` / `TEACHER`
* **Schritte**:
  1. Bereits zugewiesene Lehrkraft meldet sich am Einsatztag krank oder Schulamt hebt Zuweisung auf.
* **Erwartetes Ergebnis**:
  - Zuweisung wechselt auf `REJECTED`.
  - Durch den partiellen Unique-Index blockiert dieser Tag keine künftige Neuzuweisung einer anderen Ersatzkraft.
  - Der Bedarf wird automatisch wieder auf `PARTIALLY_FILLED` bzw. `PENDING` gesetzt.

### 12. Vorzeitige Rückkehr der Stammlehrkraft
* **Rolle**: `SCHOOL`
* **Schritte**:
  1. Schule meldet in der Bedarfsübersicht "Vorzeitige Rückkehr" zum Stichtag X.
* **Erwartetes Ergebnis**:
  - Alle Zuweisungen nach Stichtag X werden storniert.
  - `endedAt` und `endDate` werden auf Stichtag X gesetzt.
  - Der Bedarf gilt als beendet und wird nicht mehr als offen gelistet.

### 13. PDF-Download je Rolle (Autorisierungsmatrix)
* **Rolle**: Alle Rollen testen für `/api/assignments/[id]/pdf`
* **Matrix**:
  - Betroffene Mobile Reserve: **200 OK** (vollständiges Abordnungs-PDF)
  - Zuständiges Schulamt: **200 OK**
  - Anfragende Schule (Zielschule): **403 Forbidden**
  - Stammschule der Lehrkraft: **403 Forbidden**
  - Administrator: **403 Forbidden**
  - Fremdes Schulamt / fremde Lehrkraft: **403 Forbidden**

### 14. SMTP-Ausfall, Outbox & Retry
* **Rolle**: `SCHULAMT`
* **Schritte**:
  1. Falsche SMTP-Port-/Host-Angabe einstellen.
  2. Zuweisung vornehmen.
  3. Menü "Einstellungen" -> "E-Mail-Postausgang (Outbox)" aufrufen.
* **Erwartetes Ergebnis**:
  - Die fachliche Zuweisung schlägt nicht fehl; sie wird erfolgreich gespeichert.
  - Die Benachrichtigung wird verschlüsselt in der `EmailOutbox` abgelegt.
  - In der UI erscheint der Eintrag als "Ausstehend" mit Fehlergrund.
  - Nach Korrektur der SMTP-Daten kann der Versand manuell oder über den 30s-Scheduler erfolgreich wiederholt werden.

### 15. Vollständiges Backup & Restore v2.0
* **Rolle**: `SCHULAMT`
* **Schritte**:
  1. Auf `/schulamt/dokumentation` "Vollständiges Backup jetzt herunterladen" klicken.
  2. Datei prüfen: Version `2.0`, JSON mit Logo-, Signatur- und Schulbild-Assets (Base64 + SHA-256).
  3. Datei wieder hochladen und Bestätigung durchführen.
* **Erwartetes Ergebnis**:
  - Alle Daten (inkl. `isSmall`, Geodaten, `endedAt`) werden verlustfrei wiederhergestellt.
  - Magic Bytes und SHA-256 werden vor Datenbankänderungen verifiziert.
  - Dateien werden mit neuen UUIDs im privaten/öffentlichen Verzeichnis angelegt.

### 16. Logout & Sitzungsablauf
* **Rolle**: Alle Rollen
* **Schritte**:
  1. Auf "Abmelden" klicken.
  2. Browser-Zurück-Taste betätigen.
* **Erwartetes Ergebnis**:
  - Push-Subscription wird vor dem Logout bestmöglich deregistriert.
  - Sofortige Hard-Navigation zur Anmeldeseite (`/`).
  - Zurück-Button zeigt keine geschützten Daten aus dem Cache.
  - 401-Antworten leiten einmalig zur Anmeldung weiter ohne Refresh-Loop.

### 17. Update-Hinweis & SemVer-Prüfung
* **Rolle**: `SCHULAMT`
* **Schritte**:
  1. Einstellungen -> "System-Updates" prüfen.
* **Erwartetes Ergebnis**:
  - Zeigt aktuelle Version und Commit-Hash an.
  - Vergleicht mit GitHub-Releases via SemVer (z. B. `16.3.4`).
  - Bei neuer Version erscheint ein unaufdringlicher Hinweis-Banner.
