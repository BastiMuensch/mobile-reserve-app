# Stammschulen: Einsatzübersicht und E-Mail

Schulen erreichen unter **Unsere Mobilen Reserven** die Einsätze der Lehrkräfte,
die ihnen im aktuellen Schuljahr als Stammschule zugeordnet sind. Angezeigt werden
Einsatzschule, tatsächliche Einsatztage, Stunden und Bestätigungsstatus. Zeiträume
ohne Zuweisung werden nicht als durchgehender Einsatz dargestellt.

Die Übersicht unterscheidet heutige, geplante, beendete und entfallene Einsätze.
Eine verbindlich vom Schulamt angelegte Zuweisung erscheint auch dann, wenn die
Lehrkraft sie noch nicht bestätigt hat. Vorschläge aus der Idealbesetzung erzeugen
erst nach Freigabe Zuweisungen und Benachrichtigungen.

## Optionale Benachrichtigungen

Auf der Übersichtsseite kann jede Schule E-Mails für ihre Mobilen Reserven
einschalten. Die Einstellung ist zunächst ausgeschaltet. Neue Zuweisungen,
Bestätigungen, Absagen und das vorzeitige Ende eines offenen Bedarfs erzeugen
Meldungen an die aktuelle E-Mail-Adresse des Schulkontos. Zusammengehörige Tage
werden innerhalb eines Vorgangs in einer Nachricht zusammengefasst.

Die Meldungen enthalten Lehrkraft, Einsatzschule, Tage und Stunden. Kommentare
zur Vertretung und Gründe für Abwesenheiten werden nicht an die Stammschule
weitergegeben. Die Übersicht und der Mailversand berücksichtigen die Zuordnung
zum Schulamt.

Mails werden zusammen mit der Einsatzänderung im vorhandenen verschlüsselten
Mail-Ausgang gespeichert. Für die Zustellung muss der Mailversand des Schulamts
eingerichtet sein. `NEXT_PUBLIC_APP_URL` ergänzt den direkten Link zur Übersicht.
Ein regulär abgelaufener Einsatz wird in der Übersicht automatisch als beendet
angezeigt; dafür wird keine zusätzliche tägliche Erinnerungsmail versendet.

## E-Mail-Adresse selbst ändern

Unter **Schulprofil → E-Mail-Adresse der Schule** kann die Schule ihre Adresse
ändern. Sie wiederholt die neue Adresse und bestätigt ihr aktuelles Passwort.
Die Adresse gilt anschließend sowohl für die Anmeldung als auch für neue
Benachrichtigungen. Bereits eingereihte Nachrichten behalten ihre beim jeweiligen
Vorgang gespeicherte Empfängeradresse.

Die aktuelle Sitzung bleibt angemeldet. Andere Sitzungen sowie bisherige
Passwort-Reset-Links werden ungültig. Bereits verwendete E-Mail-Adressen können
nicht erneut vergeben werden.

## Installation

Die Migration `20260929160000_school_reserve_notifications` ergänzt die
Benachrichtigungseinstellung an Schulen. Vor dem Start der aktualisierten
Anwendung die üblichen Prisma-Migrationen mit `npx prisma migrate deploy`
anwenden und den Prisma-Client beim Build neu erzeugen. Bestehende Schulen starten
mit ausgeschalteter Benachrichtigung. Datensicherungen erhalten diese Einstellung;
ältere Sicherungen ohne das Feld werden mit ausgeschalteter Benachrichtigung
eingelesen.
