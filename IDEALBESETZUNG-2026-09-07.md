# Idealbesetzung – gezielte Nachprüfung und Korrekturen

## Auftrag und Umfang

Nach der besprochenen Analyse wurden die Korrekturen vom Nutzer freigegeben. Drei Terra-Agenten übernahmen Berechnung, Oberfläche und unabhängige Tests; die Hauptinstanz prüfte die Zusammenführung, ergänzte die Serverabsicherung und weitere Gegenproben. Bestehende Änderungen im Arbeitsverzeichnis wurden erhalten.

## Änderungen

- `src/lib/batchMatching.ts`: feste Abbruchgrenze statt mitschrumpfender Schleifenbedingung; einmalige Expansion der Bedarfstage; keine vergangenen Tage; ausgewähltes Schuljahr; korrekte Metadaten für laufende/vorzeitig beendete Bedarfe; Berlin-Kalendertag.
- Gleiche Kandidaten werden nach konkurrierenden Einsatzmöglichkeiten unterschieden. Eine begrenzte Nachprüfung kann eine einzelne Tagesbesetzung zu einer freien passenden Lehrkraft verschieben, um einen sonst offenen Tag zu besetzen. Sie erzeugt dabei keine zusätzliche Mehrarbeit. Bestehende Verfügbarkeits-, Stundenplan- und Schuljahresprüfungen bleiben wirksam.
- Alternativen werden gegen den fertigen Plan berechnet. Mehrarbeitskennzeichnungen berücksichtigen die endgültigen Wochenstunden.
- `src/lib/batchPlanning.ts`, `src/app/api/batch-assign/preview/route.ts`, `src/app/api/batch-assign/approve/route.ts`: gemeinsamer Zeitraumvertrag mit `schoolYear` und `until`, Planung ab heute bzw. Beginn des zukünftigen Schuljahres, Serverprüfung sämtlicher freizugebender Tage. Historische Planung bleibt von der automatischen Idealbesetzung getrennt.
- Die Freigabe ohne `allowOvertime: true` wird bei Mehrarbeit mit `409 / OVERTIME_CONFIRMATION_REQUIRED` abgebrochen. Zuweisungen, Bedarfsstatus und Outbox-Einträge werden gemeinsam zurückgerollt. Erst die ausdrückliche Bestätigung erlaubt den erneuten, frisch validierten Freigabeversuch.
- `src/components/schulamt/BatchAssignView.tsx`, `src/lib/batchPlanClient.ts`, `src/app/schulamt/idealbesetzung/page.tsx`: Schuljahr und Momentaufnahme sichtbar; Parameterwechsel/fehlgeschlagene Neuberechnung verwerfen den alten Plan; verspätete Antworten dürfen ihn nicht wiederherstellen. Konflikte nach Tauschen blockieren die Freigabe, einschließlich bereits freigegebener tatsächlicher Besetzungen. Freigegebene Zeilen sind schreibgeschützt. Bestätigungen beziehen sich auf den eingefrorenen Entwurf; Planänderungen und parallele Freigaben sind währenddessen gesperrt. Mehrarbeit und Versandwarnungen werden angezeigt.

## Prüfungen

- Unit-/Regressionstests: 112 bestanden; sieben DB-Testdateien werden ohne explizite Testdatenbank absichtlich übersprungen.
- Separater PostgreSQL-Integrationstestlauf: neun Tests bestanden, darunter drei neue Prüfungen für Mehrarbeits-Rollback, bestätigte Freigabe und vollständigen Rollback bei einem späteren Segmentkonflikt.
- Zusätzliche Invariantenprüfung über 40 synthetische Konstellationen: keine doppelte Tagesbelegung, verfügbare Lehrkräfte, passende Unterrichtsstunden, konsistente Abdeckung und tatsächlich freie Alternativen.
- Die zeitbezogenen Matching-/Planungstests bestehen auch mit `TZ=UTC`.
- Synthetischer Lauf mit 100 Anforderungen, 100 Lehrkräften und einem Zeitraum von 20 Werktagen: etwa 0,1–0,2 Sekunden für die reine Berechnung auf diesem Rechner. Kein Produktionslasttest.
- Echter lokaler Vorschlags-Endpunkt: gültiger Zeitraum liefert 200; abgeschlossenes Schuljahr und Stichtag außerhalb des Schuljahres liefern jeweils 400. Alle vorgeschlagenen Tage lagen im zurückgelieferten Zeitraum.
- Browserprüfung über `scripts/check-batch-ui.mjs` bestanden (Exit 0): verspätete Vorschläge, Schuljahreswechsel, fehlgeschlagene Neuberechnung, Tauschen mit Konflikten, bereits freigegebene Belegungen und ausdrückliche Mehrarbeitsbestätigung. Die Vorschlags- und Freigabeantworten werden dafür gezielt simuliert, damit keine Einsätze oder Nachrichten entstehen. Desktop-/Mobilansicht wurden aufgenommen und geprüft (`output/ui-audit/idealbesetzung.png`, `idealbesetzung-mobile.png`).
- Zusätzlich echter Browserdurchlauf der Vorschlagsberechnung mit den lokalen Testdaten bestanden, ohne Laufzeitfehler; Bild `output/ui-audit/idealbesetzung-real.png`.
- Abschließender Produktionsbuild, TypeScript, ESLint und `git diff --check` bestanden. Der normale `tsx`-CLI-Teststart ist in der Sandbox wegen seines IPC-Sockets eingeschränkt; der gleichwertige Testlauf wurde mit `node --import tsx --test tests/*.test.ts` ausgeführt.

## Grenzen

Die Idealbesetzung bleibt eine nachvollziehbare Heuristik, kein mathematisches Optimierungsversprechen. Die zusätzliche Reparatur ist bewusst auf einzelne Tagesabschnitte und eine feste Anzahl Versuche begrenzt; komplexe mehrstufige Umplanungen können weiterhin manuell sinnvoll sein. Laufende Bedarfe ohne Enddatum behalten den bestehenden rollierenden Horizont von fünf Werktagen. Abwahlen lösen keine automatische Neuverteilung aus; die Oberfläche weist auf eine erneute Berechnung hin.

Nur die bestätigte lokale synthetische Datenbank wurde für Tests verwendet. Kein echter Mailversand, keine produktiven Datenänderungen, kein Commit oder Push in diesem Arbeitsschritt.
