# UI-Konsistenzprüfung – 7. September 2026

## Umgesetzt

- Dokumentation: Datensicherung und Excel-Export in gleich breiten Karten nebeneinander auf großen Displays, darunter ein kompakter Schuljahreswechsel. Auf schmaleren Displays gestapelt. Keine doppelte Backup-Karte unter dem Löschbereich.
- Endgültiges Löschen steht am Ende in einem zurückhaltenden, standardmäßig geschlossenen Abschnitt. Die vorhandenen Passwort-, Bestätigungs- und Wiederherstellungsabfragen wurden nicht verändert.
- Reserven-Aktionen: gleiche Höhe, Rundung, Schriftgröße und Icons. Mobil volle Breite untereinander. „Lehrkraft hinzufügen“ hat ein Plus-Icon; „Reserve einladen“ bleibt grün hervorgehoben.
- Gemeinsame Button-Stile: Standardaktionen mindestens 40 px hoch, kompakte Aktionen 32 px, normale Icon-Buttons 40 × 40 px. Lange Standardbeschriftungen dürfen umbrechen. Icon-Abstände kommen einheitlich aus `gap`, nicht zusätzlich aus alten Icon-Margins.
- Links und Buttons lösen konkurrierende Tailwind-Klassen jetzt identisch auf. Dies behebt insbesondere fehlende Rahmen an als Button gestalteten Links.
- Profil-/Abmelde-Navigation, Einsatzbestätigung, Mailausgang und Passwort-Reset verwenden die gemeinsamen Stile. Verschachtelte Link/Button-Elemente bei der Rückkehr zur Anmeldung entfernt.
- Backup-Hinweise auf den übrigen Schulamt-Seiten folgen der jeweiligen Inhaltsbreite.
- Logo und Schrift unverändert. Keine API-, Datenbank-, Mail- oder Berechtigungsänderung.

## Prüfung

Reproduzierbarer Browsercheck: `scripts/check-ui-consistency.mjs` mit `PLAYWRIGHT_MODULE` und `UI_TEST_BASE_URL` auf die lokale synthetische Testinstanz.

- 91 Layout-Prüffälle: alle sieben Schulamt-Seiten, Schul-Dashboard/-Profil, Lehrkraft-Dashboard/-Profil, Login, Einladungs-/Anlege-/Übernahmedialoge, Löschdialog sowie öffentliche Formulare und alle Einrichtungsschritte.
- Hauptansichten bei 1920, 1440, 820, 390 und 320 px; zusätzliche Dunkelmodus-Prüfungen. Geprüft werden horizontale Überläufe, abgeschnittene Buttontexte, Icon-Abstände, die drei Aktionsgrößen und das Dokumentationsraster.
- Löschbereich per Tastatur geöffnet/geschlossen und Bestätigungsdialog geprüft, ohne eine Löschung auszulösen. Keine Registrierung, Einrichtung oder fachliche Mutation abgesendet.
- Öffentliche Einladungsdaten und Einrichtungsstatus werden für die Layoutprüfung simuliert. Wegen des unten beschriebenen Bestandsfehlers wird **nur für die öffentlichen Layout-Prüffälle** zusätzlich eine anonyme Sitzungsantwort simuliert. Dies ist kein erfolgreicher Ende-zu-Ende-Nachweis für Registrierung oder Passwort-Reset.
- Separate lokale Homepage-Prüfung bestanden; Homepage-Dateien nicht verändert.
- ESLint, Produktionsbuild inklusive TypeScript und 115 Unit-/Regressionstests bestanden. Sieben Integrationstest-Dateien werden beim Unit-Lauf übersprungen; Datenbankintegration wurde für diese reine UI-Änderung nicht erneut ausgeführt.
- Screenshots liegen lokal unter `output/ui-consistency/` und `output/landing-audit/` (nicht für Git vorgesehen).

## Separater Funktionsbefund – vor der Behebung besprechen

**Hohe Priorität: Anonyme Registrierungs- und Passwort-Reset-Aufrufe werden zur Startseite umgeleitet.**

Unabhängig von den Layout-Mocks auf der lokalen Instanz reproduziert, jeweils mit frischem Browserkontext ohne Anmeldung:

- `/register/teacher?token=synthetic-layout-check` → `/`
- `/reset?token=synthetic-layout-check` → `/`

Ursache: `src/components/AuthProvider.tsx` ruft beim initialen anonymen `401` von `/api/auth/me` den zentralen Handler auf. `src/lib/authClient.ts` nimmt bislang nur `/` von der Weiterleitung aus. Dadurch verlieren auch öffentlich vorgesehene Formularseiten ihre URL einschließlich Token. Selbst die Meldung zu einem ungültigen Link kann nicht zuverlässig stehen bleiben.

Vorgeschlagener kleiner Folgeblock: Die ausdrücklich öffentlichen Formularpfade von dieser clientseitigen Weiterleitung ausnehmen, aber den lokalen Sitzungszustand weiterhin verwerfen. Keine geschützten Seiten oder APIs freigeben. Regressionstests für anonyme Direktaufrufe beider Formulare sowie unveränderte Weiterleitung bei abgelaufenen Sitzungen auf geschützten Seiten ergänzen. Danach echte Einladungs- und Reset-Flows in einer isolierten Testinstanz prüfen.

Dieser Funktionsfix ist bewusst noch nicht Teil der freigegebenen Designänderung.
