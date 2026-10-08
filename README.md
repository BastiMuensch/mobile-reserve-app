Mobile Reserven organisieren — statt Telefonliste führen.
Schulen melden ihren Bedarf, das Schulamt findet die passende Lehrkraft und weist zu, die Lehrkraft bestätigt. Jeder Einsatz ist dokumentiert und abrechenbar.

**Installation:** Die [Anleitung für einen frischen Debian-VPS](INSTALLATION-VPS.md)
führt von der Servervorbereitung bis zur HTTPS-Adresse und zum ersten Backup.
Die Befehle werden direkt bei den jeweiligen Schritten erklärt.

Die Übersicht zeigt offene Bedarfe standardmäßig nach Datum aufsteigend; die Sortierung nach Dringlichkeit bleibt wählbar. „Keine Reserve verfügbar“ gilt für den ausgewählten Einsatztag. Weitere Tage desselben Bedarfs bleiben für die Planung offen; die Tagesabsage kann einzeln zurückgenommen werden.

Das Schulamt kann eine MR für mehrere Einsatztage gemeinsam zuweisen. Abweichungen von den regulären Einsatztagen oder Unterrichtsstunden sind bei manuellen Zuweisungen nach Bestätigung des Hinweises möglich. Automatische Vorschläge halten den hinterlegten Plan ein. Jeder bestehende Einsatz verplant die MR für den ganzen Tag, auch wenn nur ein Teil ihrer Stunden zugewiesen ist. Die MR kann alle bereits zugewiesenen offenen Tage derselben Anforderung gemeinsam bestätigen; später ergänzte Tage benötigen eine neue Bestätigung.

Neue Bedarfe verwenden diese Vertretungsgründe: ungeplanter Ausfall (Priorität 1), Dienstbefreiung / Freistellung vom Dienst (Priorität 2), Fortbildung (Priorität 3) und weitere Gründe (Priorität 4). „Schulintern geblockt“ steht nicht mehr zur Auswahl; historische Angaben bleiben erhalten.

Die tageweisen Absagen benötigen die Migration `20261005120000_request_unfilled_days`. Der reguläre Containerstart führt sie automatisch aus. Vorhandene ältere Absagen für ganze Anforderungen werden nicht nachträglich verändert; sie können ausdrücklich zurückgenommen werden.

Schulen können beim Bedarf optional eine Klasse / Lerngruppe angeben (z. B. „3a“).
Einzel- und Idealbesetzung zeigen, wer in der Kalenderwoche vor dem ersten vorgeschlagenen
Einsatztag bereits für dieselbe Klasse eingeplant war. Bei mehrtägigen und offenen
Bedarfen erhöht diese Erfahrung die Bewertung; mehr Einsatztage ergeben einen
höheren Bonus. Schulamt, Schule, Standort und Schuljahr bleiben getrennt. Ohne
Klassenangabe wird nur dieselbe Anforderung verglichen. Bestätigte und noch
unbestätigte Zuweisungen zählen, stornierte Einsätze nicht. Verfügbarkeit,
Stammschulbindung und Qualifikation behalten ihre bisherigen Regeln.

Unter „Stunden & Statistik“ stehen die geplanten Unterrichtsstunden pro Reserve für eine
ausgewählte Woche, einen Monat und insgesamt im ausgewählten Schuljahr. Wochen
laufen Montag bis Sonntag und werden an Schuljahresgrenzen begrenzt. Die Übersicht
trennt bestätigte und noch unbestätigte Stunden, zeigt Wochenlimitüberschreitungen
und bietet einen Monats-/Wochenverlauf je Reserve. „Auswahl als CSV“ exportiert die
sichtbaren Summen; „Alle Wochen und Monate als CSV“ exportiert den Schuljahresverlauf
der ausgewählten Reserve bzw. aller Reserven. Zeiträume ohne Einsätze werden im
Verlauf ausgelassen. Die vorhandenen Monats-PDFs bleiben Einsatzpläne. Eine Erfassung
der tatsächlich geleisteten Arbeitszeit einschließlich Vor-/Nachbereitung und
Fahrzeiten ist damit nicht enthalten; die Einheit ist Unterrichtsstunden (UStd.).

Die Klassenangabe benötigt die additive Migration `20261008120000_request_class_name`.
Bestehende Bedarfe bleiben ohne Klassenangabe; es werden keine Klassen aus Namen
oder Kommentaren abgeleitet. Klassenangaben bleiben in Sicherungen und im Excel-
Jahresexport erhalten. Der reguläre Containerstart führt Migrationen automatisch aus.

Vertretung organisieren kostet heute zu viel Zeit

Telefonketten am Morgen
Wer ist frei, wer ist qualifiziert, wer wohnt nah genug? Die Antwort steckt in Köpfen und Notizzetteln.

Listen, die nie stimmen
Parallel gepflegte Tabellen laufen auseinander, sobald sich eine Zuweisung ändert.

Nachweise fehlen
Am Monatsende muss rekonstruiert werden, wer wann wo im Einsatz war — für jede Lehrkraft einzeln.

DREI ROLLEN, EIN SYSTEM

Jede Seite sieht genau das, was sie braucht

Getrennte Zugänge für Schule, Schulamt und Lehrkraft — mit Zugriff ausschließlich auf die eigenen Daten.

Schul-Dashboard mit dem Formular zur Bedarfsmeldung
Schule meldet Bedarf in unter einer Minute: Datum, Stunden, Schulart, Pflichthinweise für den Einsatztag. Sieht anschließend, wer kommt — samt Qualifikation, Telefonnummer und ob bereits bestätigt wurde.

Schulamt-Dashboard mit offenen Bedarfen und Kandidatenliste
Schulamt sieht alle Bedarfe der eigenen Schulen, bekommt bewertete Vorschläge und weist mit einem Klick zu. Karte, Statistiken, Monatsabrechnung und Datensicherung inklusive.

Monatsmeldung an die Regierung

Unter „Monatsmeldung“ wählt das Schulamt einen Stichtag im ausgewählten Schuljahr.
Die Vorschau zeigt die Positionen 1a bis 5b und jede zugrunde liegende Lehrkraft.
Bei der ersten Meldung werden Lehrkraftart und maximale mobile Wochenstunden bestätigt.
Fachlehrkräfte (EG, MT und sonstige) zählen nicht. Kurzzeitig Erkrankte bleiben im
Bestand; bei dauerhafter Nichtverfügbarkeit wird „Im MR-Bestand“ abgewählt.
„Angaben gültig ab“ hält Änderungen an Bestand und Stunden zeitlich fest. Bei einer
Rückkehr wird ein neuer Stand ab dem Rückkehrdatum gespeichert. Medizinische Gründe
werden nicht erfasst. Im neuen Schuljahr werden diese Angaben erneut geprüft.

Die Einsatzzuordnung ist ein prüfbarer Vorschlag aus den Zuweisungen am Stichtag.
Mehr als 28 Kalendertage gelten als langfristig. Bei fest geplanten Zuweisungen wird
die bekannte Dauer berücksichtigt, bei offenen Einsätzen nur die bereits erreichte
Dauer. Lücken von mehr als sieben Tagen trennen den Vorschlag in neue Einsatzabschnitte.
Ferien, Teilzeit, gemischte Einsätze und bekannte Verlängerungen müssen deshalb in
der Vorschau geprüft werden. Der Einsatzstatus kann für die Meldung angepasst werden;
jede Person zählt nur einmal. Klassen aus schulhausinternen Maßnahmen (6a/6b) werden
manuell eingetragen. Eine fehlende Angabe wird nicht als null Klassen gewertet.

Entwürfe lassen sich speichern. Erst nach vollständiger Zuordnung, Klassenangaben
und ausdrücklicher Prüfung ist der Excel-Export freigegeben. Er enthält ausschließlich
die aggregierte Regierungstabelle im Blatt „Vertretungssituation“, Werte in A8:K8.
Gespeicherte Meldungen sind Stichtagsstände und ändern sich nicht durch spätere
Stammdatenänderungen. „Meldung bearbeiten“ übernimmt den gespeicherten Stand;
„Neu aus App berechnen“ lädt aktuelle Daten. Erst Speichern ersetzt die alte Meldung.
Datierte MR-Angaben und Meldungen sind in Vollbackups und JSON-Sicherungen enthalten.

Die Erweiterung benötigt die Migration `20260917120000_government_reports`.
Der reguläre Containerstart führt Migrationen wie bisher automatisch aus.

Lehrkraft-Dashboard mit dem nächsten Einsatz und der Schaltfläche zum Bestätigen
Lehrkraft sieht den nächsten Einsatz mit Anfahrt, Hinweisen der Schule und Ansprechpartner — und bestätigt ihn mit einem Fingertipp. Ein Ausfall lässt sich direkt melden.

Findet die passende Vertretung — nach Ihren Regeln

Jede Lehrkraft wird für den konkreten Bedarf bewertet und sortiert. Die Entscheidung bleibt beim Schulamt, die Vorarbeit übernimmt das System.

1 Stammschule zuerst. Wer die Schule kennt, ist schneller einsatzbereit.
2 Qualifikation. Schulart und passende Fächer — abgestimmt auf den gemeldeten Bedarf.
3 Entfernung. Luftlinie zwischen Wohnort und Einsatzschule, kilometergenau.
4 Wochenstunden. Wer sein Deputat in dieser Woche erreicht hat, rutscht ans Ende — gerechnet für die Woche des Einsatzes, nicht die laufende.
5 Teilzeit-Stundenplan. Wer dienstags nicht arbeitet, wird dienstags nicht vorgeschlagen.
6 Konflikte und Ausfälle. Doppelbelegungen werden erkannt und blockiert, gemeldete Ausfälle fallen automatisch heraus.


## Schulen mit Außenstellen

Unter **Schulprofil → Außenstellen** kann eine Schule mehrere weitere Standorte mit
Adresse, Foto, eigenen Hinweisen und Ankunftspunkten pflegen. Jede Außenstelle wird
separat gespeichert. Vorhandene Schulangaben bleiben der Hauptstandort.

Nur bei mehreren aktiven Standorten erscheint beim Melden eines Bedarfs die direkte
Auswahl **Einsatzort**. Ein Bedarf gilt für einen festen Standort. Die Auswahl wird
bei Einzel- und Idealbesetzung für Entfernungen sowie in Einsatzdetails, Karten,
E-Mails, Kalenderdateien und Nachweisen verwendet. Stammschulregeln und Statistiken
beziehen sich weiterhin auf die gemeinsame Schule. Fehlende Außenstellen-Koordinaten
werden nicht durch die Koordinaten des Hauptstandorts ersetzt.

Außenstellen können für neue Anforderungen deaktiviert werden; bestehende Bedarfe
bleiben ihnen zugeordnet. JSON-Sicherungen und Vollbackups enthalten Standorte,
Zuordnungen und Fotos. Alte Sicherungen und bestehende Bedarfe verwenden weiterhin
den Hauptstandort. Erforderliche additive Migration: `20261005150000_school_locations`.
