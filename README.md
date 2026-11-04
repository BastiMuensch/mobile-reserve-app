Mobile Reserven organisieren — statt Telefonliste führen.
Schulen melden ihren Bedarf, das Schulamt findet die passende Lehrkraft und weist zu, die Lehrkraft bestätigt. Jeder Einsatz ist dokumentiert und abrechenbar.

**Installation:** Die [Anleitung für einen frischen Debian-VPS](INSTALLATION-VPS.md)
führt von der Servervorbereitung bis zur HTTPS-Adresse und zum ersten Backup.
Die Befehle werden direkt bei den jeweiligen Schritten erklärt.

Die Übersicht zeigt offene Bedarfe standardmäßig nach Datum aufsteigend; die Sortierung nach Dringlichkeit bleibt wählbar. „Keine Reserve verfügbar“ gilt für den ausgewählten Einsatztag. Weitere Tage desselben Bedarfs bleiben für die Planung offen; die Tagesabsage kann einzeln zurückgenommen werden.

Unter „Einstellungen“ kann jedes Schulamt Nachrichten ans Schulamt für seine Schulen
freischalten. Die Option ist standardmäßig deaktiviert und erscheint erst nach der
Freischaltung im Schulformular und als „Nachricht ans Schulamt“ am Bedarf. Eine
bereits vorhandene Nachricht bleibt auch nach dem Abschalten einsehbar und entfernbar. Die Schule kann ihre eigene Nachricht später einsehen und bearbeiten. Für Mobile Reserven bleibt sie unsichtbar; das Schulamt öffnet sie über das Nachrichtensymbol am Bedarf.
Die Einstellung benötigt die Migration `20261009120000_optional_request_urgency_note`,
die beim regulären Containerstart automatisch angewendet wird.

Auch Reserven mit weniger verfügbaren Stunden werden vorgeschlagen. Eine Reserve mit
vier passenden Stunden kann einen Sechs-Stunden-Bedarf teilweise übernehmen; die zwei
übrigen Stunden bleiben offen. Da Zuweisungen bislang nur Stundenzahlen speichern,
muss eine automatisch ergänzende Reserve den gesamten ursprünglichen Stundenblock
abdecken können. Abweichende Ergänzungen sind nach ausdrücklicher Bestätigung manuell
möglich. Dringlichkeit und Idealbesetzung berücksichtigen den durchschnittlichen
Stundenbedarf je Einsatztag: Umfangreichere Bedarfe erhalten zusätzliches Gewicht,
während kleine Schulen und Häufungen weiterhin berücksichtigt werden.

Vollständig versorgte mehrtägige Bedarfe verschwinden aus der offenen Übersicht; bei
„bis auf Weiteres“ gilt dies für den aktuellen Planungshorizont. Ausfälle und neue
unbesetzte Planungstage öffnen sie wieder. „Besetzte Bedarfe“ zeigt auch vorhandene
Zuweisungen teilweise versorgter Anforderungen, ausstehende Bestätigungen und den
Namen der zu vertretenden Lehrkraft.

Das Schulamt kann eine MR für mehrere Einsatztage gemeinsam zuweisen. Abweichungen von den regulären Einsatztagen oder Unterrichtsstunden sind bei manuellen Zuweisungen nach Bestätigung des Hinweises möglich. Automatische Vorschläge halten den hinterlegten Plan ein. Jeder bestehende Einsatz verplant die MR für den ganzen Tag, auch wenn nur ein Teil ihrer Stunden zugewiesen ist. Die MR kann alle bereits zugewiesenen offenen Tage derselben Anforderung gemeinsam bestätigen; später ergänzte Tage benötigen eine neue Bestätigung.

Neue Bedarfe verwenden diese Vertretungsgründe: ungeplanter Ausfall (Priorität 1), Dienstbefreiung / Freistellung vom Dienst (Priorität 2), Fortbildung (Priorität 3) und weitere Gründe (Priorität 4). „Schulintern geblockt“ steht nicht mehr zur Auswahl; historische Angaben bleiben erhalten.

Die tageweisen Absagen benötigen die Migration `20261005120000_request_unfilled_days`. Der reguläre Containerstart führt sie automatisch aus. Vorhandene ältere Absagen für ganze Anforderungen werden nicht nachträglich verändert; sie können ausdrücklich zurückgenommen werden.

Schulen können beim Bedarf optional eine Klasse / Lerngruppe angeben (z. B. „3a“).
Einzel- und Idealbesetzung zeigen, wer in der Kalenderwoche vor dem ersten vorgeschlagenen
Einsatztag bereits für dieselbe Klasse eingeplant war. Bei eintägigen, mehrtägigen und
offenen Bedarfen erhöht diese Erfahrung die Bewertung; mehr Einsatztage ergeben einen
höheren Bonus. Schulamt, Schule, Standort und Schuljahr bleiben getrennt. Ohne
Klassenangabe wird nur dieselbe Anforderung verglichen. Beim ausgewählten Bedarf steht oben
„Zuletzt in Klasse …“ mit den Lehrkräften, die im Schuljahr bereits dort waren; dieselben
Reserven sind in der Vorschlagsliste markiert. Groß-/Kleinschreibung, Leerzeichen und ein
vorangestelltes „Klasse“ bzw. „Kl.“ werden beim Vergleich ignoriert („3a“ = „3 a“ = „Klasse 3a“). Bestätigte und noch
unbestätigte Zuweisungen zählen, stornierte Einsätze nicht. Verfügbarkeit,
Stammschulbindung und Qualifikation behalten ihre bisherigen Regeln.

Unter „Stunden & Statistik“ stehen die geplanten Unterrichtsstunden pro Reserve für eine
ausgewählte Woche, einen Monat und insgesamt im ausgewählten Schuljahr. Wochen
laufen Montag bis Sonntag und werden an Schuljahresgrenzen begrenzt. Die Übersicht
trennt bestätigte und noch unbestätigte Stunden, zeigt Wochenlimitüberschreitungen
und bietet einen Monats-/Wochenverlauf je Reserve. „Auswahl als CSV“ exportiert die
sichtbaren Summen; „Alle Wochen und Monate als CSV“ exportiert den Schuljahresverlauf
der ausgewählten Reserve bzw. aller Reserven. Zeiträume ohne Einsätze werden im
Verlauf ausgelassen. Die vorhandenen Monats-PDFs bleiben Einsatzpläne. Schulen können für bestätigte, bereits stattfindende oder vergangene Einsätze Ist-Stunden und zusätzliche Aufgaben melden. Erst die Freigabe des Schulamts übernimmt sie in die separaten Ist-Summen. Planstunden bleiben erhalten; fehlende Meldungen gelten nicht als geleistet. Unterrichtsstunden (UStd.) und Minuten für weitere Aufgaben werden getrennt ausgewiesen.

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

1 Fachliche Eignung. Benötigte Schulart, Jahrgangsstufe und Fächer werden mit den hinterlegten Qualifikationen abgeglichen.
2 Stammschule. Innerhalb der fachlich passenden Gruppe erhält die eigene Schule deutlichen Vorrang.
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


## Schulamtsbezirke und Registrierung

Schulen und Mobile Reserven haben ein optionales Feld **Schulamtsbezirk**.
Namen oder Kürzel können frei eingegeben werden. Die Angaben werden
getrimmt und in Großbuchstaben gespeichert. Bestehende Datensätze bleiben ohne
Zuordnung, bis das Schulamt sie ergänzt. Die Zuordnung einer Reserve ist unabhängig
von ihrer Stammschule und kann bei der Registrierung angegeben werden.

Unter **Einstellungen → Bedarf & Zuweisung → Schulamtsbezirke** kann das Schulamt
eine Liste seiner Bezirke anlegen (z. B. BT, BTL). Ist die Liste gefüllt, wählen
Registrierung, Reservenverwaltung und Schulverwaltung den Bezirk aus einer Auswahl
statt aus Freitext; der Server nimmt nur noch Bezirke aus der Liste an. Eine bereits
gespeicherte abweichende Angabe bleibt beim Bearbeiten erhalten und ist als
„bisherige Angabe“ markiert. Unter **Abweichende Angaben** werden alle Schreibweisen
angezeigt, die nicht in der gespeicherten Liste stehen. Sie lassen sich mit einem Klick
in die Liste übernehmen oder für alle Schulen und Reserven des Schulamts mit einem
Listeneintrag zusammenführen. Ohne Liste bleibt es beim Freitext.

Mit **Bezirksfilter in den Übersichten anzeigen** lässt sich die standardmäßig
ausgeschaltete Filterfunktion einschalten. Nur dann stehen
in Übersicht, Reservenliste und Schulverwaltung die Filter **Alle
Schulamtsbezirke**, bereits eingetragene Bezirke und **Ohne Zuordnung** zur Verfügung.
Beim Ausschalten werden alle Einträge angezeigt.
In der Übersicht betrifft der Filter Bedarfe, Kartenpunkte und Reservenvorschläge.
Die Kennzahlen im Kopfbereich beziehen sich weiterhin auf das gesamte Schulamt.
Der Filter ändert keine Berechtigungen oder Regeln für die Einsatzzuweisung.

Bei der Registrierung öffnet sich ein Fenster zu Art und Zweck der Datenspeicherung,
ergänzt um die unter Einstellungen hinterlegte Datenschutzerklärung des Betreibers.
Die Registrierung erfordert eine ausdrückliche Kenntnisnahme. Der Server speichert
Zeitpunkt, Textstand und den angezeigten Text. Ändert sich der Hinweis vor dem Absenden,
muss der neue Stand erneut bestätigt werden. Vorhandenen oder vom Schulamt angelegten
Reserven wird keine nachträgliche Bestätigung zugeschrieben.

Bezirke und Bestätigungsnachweise bleiben in JSON-Sicherungen und bei der Übernahme
ins nächste Schuljahr erhalten. Erforderlich ist die additive Migration
`20261027120000_district_and_registration_privacy` sowie
`20261027130000_optional_district_filter`; der reguläre Containerstart
wendet sie automatisch an.


## Bedarfsänderungen, Stundenmeldungen und passende Besetzung

Schulen können über **Bedarf ändern / beenden** auch bereits besetzte und fest
befristete Anforderungen stornieren oder eine frühere Rückkehr melden. Das Formular
fragt nach dem letzten benötigten Einsatztag. Entfallende heutige und zukünftige
Zuweisungen werden aufgehoben und die betroffenen Reserven benachrichtigt. Ist heute
bereits eine Reserve eingeplant, kann die Schule beim Stornieren den heutigen Einsatz
behalten (vorausgewählt); dann entfallen erst die Einsätze ab morgen und die geleisteten
Stunden lassen sich weiterhin melden. Bereits
gemeldete oder freigegebene Arbeit bleibt für die Prüfung und Auswertung erhalten;
bei vollständiger Beendigung entsteht daraus kein neuer offener Bedarf. Bereits
vergangene Einsätze bleiben nachvollziehbar; eine rückwirkende Meldung überschreibt
keine geleisteten Stunden. Verfügbarkeit berücksichtigt weiterhin andere Einsätze,
Fehlzeiten und die Stammschulbindung. Jede Beendigung wird als Ereignis gespeichert.

**Stunden melden / korrigieren** erscheint, sobald ein Einsatztag erreicht ist, und
erhält die geplante Stundenzahl. Künftige Einsätze werden dort nicht angeboten. Schulen melden
die tatsächlich geleisteten Unterrichtsstunden, einen kurzen organisatorischen
Grund und gegebenenfalls zusätzliche Aufgaben in Minuten. Das Schulamt prüft und
bestätigt oder lehnt mit Begründung ab. Gleichzeitige Änderungen werden erkannt;
pro Einsatz kann nur eine Meldung auf Prüfung warten. Die Stundenübersicht und ihre
CSV-Ausgabe zeigen Plan- und freigegebene Ist-Werte getrennt. Für Wochenlimits
ersetzen freigegebene Ist-Stunden die jeweiligen Planstunden; ohne Freigabe zählt
weiterhin die geplante Belegung. Minuten für zusätzliche Aufgaben bleiben separat.
Wird eine geschützte Stundenmeldung abgelehnt oder mit null geleisteten Stunden
freigegeben, wird eine zuvor gemeldete Stornierung oder Abwesenheit nachgezogen,
sofern auch keine weiteren Aufgaben geleistet wurden. Die Jahresübersicht
exportiert beide Werte; Sicherungen erhalten auch den Änderungs- und Prüfverlauf.
Vorhandene Stundenmeldungen und Rückmeldungen bleiben für Schule und Schulamt
auch nach einer Stornierung über den Bedarf erreichbar.

Neue Anforderungen erfassen die benötigte Schulart, optional eine Jahrgangsstufe
und ein Fach getrennt von der Schulart der Einrichtung. Die Besetzung berücksichtigt
GS-/MS-Lehrkräfte und Fachlehrkräfte anhand ihrer hinterlegten Eignung. Fachlich
abweichende oder unklare Zuordnungen benötigen eine ausdrückliche manuelle Prüfung.
Reserven ohne Qualifikationsstatus gelten vorläufig für alle Einsätze als passend und
erscheinen auch in den Besetzungsvorschlägen; sie werden auf ihrer Startseite direkt
aufgefordert, die Angaben zu ergänzen. Eine ausdrückliche Angabe „kein Sport“ bleibt
wirksam.

### Fachlehrkräfte (optionales Modul)

Mit **Einstellungen → Bedarf & Zuweisung → Fachlehrkräfte gesondert abfragen**
kann ein Schulamt einen dritten Bedarfstyp freischalten. Standardmäßig ist das Modul
aus: Neue Bedarfe bieten dann nur Grundschule und Mittelschule, und Profilformulare
fragen keine Fachrichtungen ab. Beim Einschalten sind die Fachrichtungen **E/G** und **M/T**
vorbelegt; die Liste ist frei änderbar. Danach gilt:

- Schulen wählen beim Bedarf „Fachlehrkraft“ und eine Fachrichtung oder „beliebig“.
  Die Jahrgangsstufe ist dabei frei wählbar.
- Fachlehrkräfte geben bei Registrierung und im eigenen Profil ihre Fachrichtungen an;
  das Schulamt kann sie in der Reservenverwaltung ergänzen.
- Fachlehrkräfte der passenden Fachrichtung werden zuerst vorgeschlagen, auch vor
  Reserven der Stammschule. Fachlehrkräfte anderer oder unbekannter Fachrichtung sowie
  GS-/MS-Lehrkräfte erscheinen als **Ausweichbesetzung**; sie lassen sich nach
  ausdrücklicher Bestätigung zuweisen. Der gemeinsame Besetzungsvorschlag plant nur
  passende Reserven ein.

Beim Ausschalten entfallen die Auswahl für neue Bedarfe und die Abfrage in
Profilformularen. Bestehende Bedarfe und Qualifikationen bleiben erhalten und
werden bei ihrer Besetzung weiterhin berücksichtigt.
Bezirksliste und Modul benötigen die Migration
`20261103120000_district_list_and_specialist_requests`, die beim regulären
Containerstart automatisch angewendet wird.

Unter passenden Lehrkräften zählen Stammschule und Klassenkontinuität. Bei gleicher
fachlicher Priorität erhält die größere Stundenabdeckung Vorrang vor der Entfernung;
Mehrarbeit wird nicht allein für eine größere Abdeckung bevorzugt. Zusammenhängende
Einsätze werden weiterhin berücksichtigt. Alte breite Qualifikationsangaben bleiben für ältere
Anforderungen lesbar; fehlende Jahrgangsstufen werden nicht aus Klassennamen erraten.

Die Besetzungsvorschläge zeigen das aktuelle Berliner Datum und den Zeitraum
**Planen bis einschließlich** mit Schnellwahlen. Mehrtägige Einsätze werden zusammen
dargestellt. Der gewählte letzte Tag begrenzt sämtliche Vorschläge; bei offenen
Bedarfen gilt weiterhin der rollierende Planungshorizont. Beim Bedarf zeigt ein
kompakter Verlauf die bisherigen Vertretungen einschließlich der laufenden Woche.

Erforderliche Migrationen: `20261102100000_request_lifecycle_hours`,
`20261102110000_request_matching_details` und `20261102120000_align_schema_indexes`.
Die letzte ergänzt bereits im Datenmodell vorgesehene Indizes und gleicht den
Zeitstempel-Standard des E-Mail-Postausgangs an. Der reguläre Containerstart wendet sie an.
Bestehende Planstunden, Anforderungen und Sicherungen bleiben kompatibel. Freitexte
aus abgeschlossenen und seit mindestens 30 Tagen geprüften Stundenmeldungen werden
mit der vorhandenen Bereinigung entfernt; freigegebene Zahlen und Entscheidungen
bleiben bis zum Ablauf der zugehörigen Einsatzdaten erhalten.
