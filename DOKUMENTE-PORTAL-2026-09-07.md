# Dokumenten-Downloads im Portal

## Umgesetzt

- Lehrkräfte: gemeinsamer Bereich „Dokumente & Abrechnung“ mit „Pro Einsatz“ und „Pro Monat“.
- Einzelansicht für das angezeigte Schuljahresprofil. Zusammenhängende Tage desselben Lehrkräfteprofils und derselben Anfrage ergeben einen Download entsprechend der unveränderten PDF-Serienlogik. Stornierungen werden separat gekennzeichnet.
- Monatsauswahl nutzt den vorhandenen Monats-PDF-Endpunkt; leere oder ungültige Monate deaktivieren den Download. Excel-Export bleibt zusätzlich verfügbar.
- Schulamt: „Mobile Reserven“ → Aktionen der Lehrkraft → „Archiv“ enthält die Einzel-PDFs, Ladeanzeige und Fehlerbehandlung mit erneutem Laden. Beim Wechsel oder Schließen werden laufende Anfragen abgebrochen und alte Downloadlinks nicht weiter angezeigt.
- Keine Änderungen an PDF-Texten, rechtlichen Formulierungen, Empfängerregeln oder Mailversand. Kein automatischer PDF-Mailversand ergänzt.

## Prüfung

- `node --import tsx --test tests/*.test.ts`: 120 bestanden, 0 fehlgeschlagen; 7 datenbankabhängige Integrationstests mangels `TEST_DATABASE_URL` übersprungen.
- `npm run lint`, `npm run build`, `git diff --check`: erfolgreich.
- `scripts/check-document-downloads.mjs`: lokaler Browsercheck mit synthetischen Konten. Reale Einzel- und Monats-PDFs (HTTP 200, PDF-Dateisignatur) und tatsächliche Browserdownloads geprüft. Einzel-PDF für Schulamt erlaubt; Schule und andere Lehrkraft erhalten HTTP 403.
- Tastaturbedienung der Tabs, leere Monatsauswahl, erhaltene Monatsauswahl nach Tabwechsel, Gruppierung und Stornierung, leere Listen sowie Archivfehler und erneutes Laden geprüft. Gruppierungs-, Leer- und Fehlerfälle nutzen ausdrücklich gemockte API-Antworten; PDF-Downloads und Rechteprüfung nutzen die echte lokale API.
- Desktop (1440 px), Handy (320 px), Dunkelmodus; keine horizontalen Überläufe oder abgeschnittenen Beschriftungen im fokussierten Check. Screenshots unter `output/document-downloads/` visuell kontrolliert.
- Bestehender Gesamtcheck `scripts/check-ui-consistency.mjs` erneut erfolgreich: 91 Layoutprüfungen. Die öffentlichen Einstiegsseiten verwenden wegen des bekannten Redirect-Problems einen Auth-Mock und sind dort ausschließlich Layouttests, keine vollständigen Registrierungs-/Reset-Workflowtests.
- Lokaler Testaufruf: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright/index.mjs UI_TEST_BASE_URL=http://127.0.0.1:3118 node scripts/check-document-downloads.mjs`. Benötigt die synthetischen `ui-test.local`-Konten und passende Testdaten. Keine fachlichen Formulare werden abgesendet.

## Grenzen / offen

- Die produktive Anfrage vom 10.08. wurde nicht reproduziert. Zur Diagnose fehlt weiterhin der genaue Fehlertext; keine Änderung der Zuweisungsregeln vorgenommen.
- Der separat dokumentierte Redirect auf öffentlichen Registrierungs-/Passwortreset-Seiten ist nicht Teil dieser Umsetzung (siehe `UI-KONSISTENZ-2026-09-07.md`).
- Commit und Push wurden nach erfolgreicher Prüfung vom Nutzer freigegeben. Ein erfolgreicher Git-Push ist noch kein Nachweis für den Abschluss des anschließenden Container-Builds.
