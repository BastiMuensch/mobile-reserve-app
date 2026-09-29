# v0.1.19 – Einsatzübersicht für Stammschulen

Schulen erhalten den neuen Reiter **Unsere Mobilen Reserven**. Er zeigt die eigenen Reserven des aktuellen Schuljahres mit Einsatzschule, tatsächlichen Einsatztagen, Stunden und Bestätigungsstatus. Aktuelle und geplante Einsätze stehen oben; beendete und entfallene Einsätze lassen sich aufklappen.

## Benachrichtigungen und Schuladresse

- Schulen können E-Mail-Benachrichtigungen zu neuen Zuweisungen, Bestätigungen, Absagen und einem festgelegten Einsatzende selbst einschalten. Die Einstellung ist zunächst ausgeschaltet.
- Auch Ausfallmeldungen und Änderungen längerer Abwesenheiten informieren die Stammschule über entfallene Einsätze. Planungsentwürfe lösen keine Meldungen aus.
- Die Nachrichten enthalten Einsatzdaten, keine Abwesenheitsgründe oder internen Vertretungskommentare. Sie werden mit der Einsatzänderung im verschlüsselten Mail-Ausgang gespeichert.
- Im **Schulprofil** können Schulen ihre E-Mail-Adresse mit Wiederholung der neuen Adresse und Bestätigung des aktuellen Passworts ändern. Die neue Adresse gilt für Anmeldung und künftige Benachrichtigungen. Andere Sitzungen und bisherige Passwort-Reset-Links werden ungültig; die aktuelle Sitzung bleibt bestehen.
- Bereits eingereihte E-Mails behalten die beim jeweiligen Vorgang gespeicherte Empfängeradresse. Die Benachrichtigungseinstellung gilt für künftige Meldungen.

## Bezeichnung Arbeitsvertrag

Die bisherige Bezeichnung **Drittkraft** heißt im gesamten Portal jetzt **Arbeitsvertrag**. Gespeicherte Angaben bleiben erhalten und zeigen automatisch die neue Bezeichnung. Die Änderung beeinflusst das Matching nicht.

## Bestehende Daten und Update

- Die Migration `20260929160000_school_reserve_notifications` ergänzt die Benachrichtigungseinstellung mit dem Standardwert „aus“. Datensicherungen erhalten die Einstellung; ältere Sicherungen bleiben importierbar.
- Datenbank, Domain und bestehende `.env` einschließlich `INVITATION_TOKEN_PEPPER`, `JWT_SECRET` und `SMTP_ENCRYPTION_KEY` beibehalten. Beim Update wie üblich `npx prisma migrate deploy` ausführen; der reguläre Containerstart führt Migrationen automatisch aus. Den Prisma-Client beim Build neu erzeugen.
- Für E-Mails muss der Mailversand des Schulamts eingerichtet sein. `NEXT_PUBLIC_APP_URL` liefert den direkten Link zur Einsatzübersicht.
- Die Veröffentlichung aktualisiert keinen laufenden Server automatisch.

## Prüfung

Automatisierte Prüfungen decken Mandantentrennung, Schuljahresgrenzen, Datensparsamkeit, Benachrichtigungseinstellungen, E-Mail-Änderungen, Sitzungen, Zuweisung, Bestätigung, Absagen, Abwesenheiten, Einsatzende und Sicherungswiederherstellung ab. Übersicht, Schulprofil und dauerhafte Speicherung der E-Mail-Einstellung wurden im Browser mit synthetischen Daten geprüft. Echter Mailversand über einen produktiven Mailserver wurde nicht ausgelöst.

Weitere Hinweise: [Stammschulen](STAMMSCHULEN.md).
