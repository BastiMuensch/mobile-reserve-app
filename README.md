Mobile Reserven organisieren — statt Telefonliste führen.
Schulen melden ihren Bedarf, das Schulamt findet die passende Lehrkraft und weist zu, die Lehrkraft bestätigt. Jeder Einsatz ist dokumentiert und abrechenbar.

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
2 Qualifikation. Grundschule, Mittelschule oder Drittkraft — passend zum gemeldeten Bedarf.
3 Entfernung. Luftlinie zwischen Wohnort und Einsatzschule, kilometergenau.
4 Wochenstunden. Wer sein Deputat in dieser Woche erreicht hat, rutscht ans Ende — gerechnet für die Woche des Einsatzes, nicht die laufende.
5 Teilzeit-Stundenplan. Wer dienstags nicht arbeitet, wird dienstags nicht vorgeschlagen.
6 Konflikte und Ausfälle. Doppelbelegungen werden erkannt und blockiert, gemeldete Ausfälle fallen automatisch heraus.
