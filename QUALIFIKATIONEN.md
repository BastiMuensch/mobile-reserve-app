# Qualifikationsstatus und Sportunterricht

Mobile Reserven geben bei der Registrierung zwei zusätzliche Pflichtangaben an:

- Qualifikationsstatus: Lehrkraft – GS, Lehrkraft – MS, Fachlehrkraft oder Arbeitsvertrag.
- Sport unterrichten: Ja oder Nein.

Beide Angaben sind ohne Vorauswahl. Sie können im eigenen Profil sowie durch das Schulamt beim Anlegen oder Bearbeiten gepflegt werden. Bestehende Profile bleiben bis zur Ergänzung ausdrücklich „Noch nicht angegeben“; im Einsatzplan erscheint ein Hinweis mit Link zum Profil. Ein fehlender Wert wird nicht als „Nein“ gewertet. Das Speichern eines vollständigen Profils erfordert beide Angaben; einzelne Statusänderungen bleiben möglich.

Schulleitungen sehen die Angaben bei ihren zugewiesenen Reserven im Detailfenster hinter dem Namen. Das Schulamt sieht sie in der Reservenübersicht und im Warteraum. Vorhandene Fächerangaben bleiben erhalten. Die neuen Angaben beeinflussen weder Rangfolge und Vorschläge noch die Zulässigkeit manueller Zuweisungen. Die Schulart im Qualifikationsstatus ist unabhängig von der bisherigen Einsatzpräferenz.

Schuljahresübernahme und Sicherungswiederherstellung erhalten die Werte. Ältere Sicherungen ohne diese Felder bleiben importierbar; ihre Werte werden als unbekannt übernommen. Änderungen im eigenen Profil werden wie die Kontaktdaten für die zum Login gehörenden Schuljahreszeilen synchronisiert.

Die frühere Auswahl „Student/in“ bleibt für vorhandene Datensätze und Sicherungen lesbar, ist aber nicht mehr auswählbar. Beim nächsten vollständigen Bearbeiten muss einer der aktuellen Statuswerte gewählt werden. Eine automatische Umstufung findet nicht statt; die Sportangabe bleibt erhalten.

Die bisherige Bezeichnung „Drittkraft“ heißt in der Oberfläche jetzt „Arbeitsvertrag“. Der gespeicherte Wert `SUPPORT` bleibt erhalten; bestehende Profile zeigen automatisch die neue Bezeichnung. Dafür ist keine Datenmigration erforderlich.

## Installation

Die Migration `20260929120000_teacher_qualification_details` ergänzt zwei nullable Spalten und eine Prüfung der zulässigen Statuswerte. `20260929130000_teacher_school_qualification` erweitert die Werte um Lehrkraft – GS und Lehrkraft – MS. Bisherige allgemeine Lehrkraft-Angaben bleiben erhalten und müssen beim nächsten vollständigen Bearbeiten um die Schulart ergänzt werden. `20260929140000_specialist_qualification` ergänzt Fachlehrkraft, ohne bestehende Datensätze zu verändern. Beim Ausrollen vor dem Start der neuen App wie üblich `npx prisma migrate deploy` ausführen und den Prisma-Client beim Build neu erzeugen. Die Migration wurde lokal ausschließlich in einer separaten Testdatenbank ausgeführt.

## Vorschau

`node scripts/preview-ui-regressions.mjs --qualifications` startet auf `http://127.0.0.1:3138` eine Vorschau mit echten UI-Komponenten und erfundenen Daten. Sie schreibt keine Daten in die Datenbank.

## Prüfung

Build, TypeScript und Lint geprüft; keine neuen Lint-Warnungen. Tests prüfen insbesondere fehlende Pflichtangaben, explizites „Nein“, unverbrauchten Einladungslink bei ungültigen Eingaben, Anzeige ohne private Adressdaten, Schuljahresübernahme und Sicherungswiederherstellung inklusive älterer Sicherungen.
