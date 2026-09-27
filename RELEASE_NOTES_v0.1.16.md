# v0.1.16 – Nur Stammschule und Schuljahresarchiv

Mobile Reserven können beim Anlegen und Bearbeiten auf ihre Stammschule beschränkt werden. Die Option „Nur Stammschule“ gilt für Einzelvorschläge, Idealbesetzung einschließlich Tauschalternativen und manuelle Zuweisungen. Beim Speichern wird die Einschränkung erneut geprüft, sodass veraltete Vorschläge abgewiesen werden. Es wird kein gesundheitlicher Grund erfasst. Die Einstellung bleibt bei Schuljahresübernahme und Sicherungswiederherstellung erhalten.

Unter „Dokumentation → Abrechnung & Nachweise“ steht ein verschlüsseltes Schuljahresarchiv bereit: Jahresübersicht, gespeicherte freigegebene Monatsmeldungen, neu erzeugte Einsatznachweise und ein Prüfbericht. Das Archiv ist nach erneuter Passwortprüfung herunterladbar und mit geeigneter ZIP-Software ohne laufende App lesbar. Es enthält den verfügbaren Datenstand und ersetzt kein Vollbackup. Hinweise auf fehlende Unterlagen, Stornierungen und offene Bestätigungen bleiben sichtbar.

Der Installationsassistent verwendet für neue Installationen standardmäßig das stabile Image `latest`; feste Versionen bleiben auswählbar. Updates werden weiterhin bewusst durch den Betreiber ausgeführt. Lokale Datenbank-Dumps, Entwicklungslogs und Lint-Berichte wurden aus der Versionsverwaltung entfernt.

## Update bestehender Installationen

- Die neue Migration ergänzt ausschließlich `Teacher.onlyStammschule` mit dem Standardwert `false`. Bestehende Reserven behalten damit ihr bisheriges Verhalten.
- Bereits gespeicherte Einsätze werden durch Aktivieren der Einschränkung nicht storniert und müssen bei Bedarf geprüft werden.
- Bestehende Datenbank, Domain und `.env` einschließlich aller Schlüssel beibehalten. Insbesondere `INVITATION_TOKEN_PEPPER` und `SMTP_ENCRYPTION_KEY` nicht neu erzeugen.
- Das Update erneuert oder widerruft keine Einladungen. Bisherige Ablaufzeiten und Einlösestatus gelten weiter; Mailkonfiguration und Outbox bleiben erhalten.
- Der reguläre Update-Ablauf wendet die Datenbankmigration an. Bei einem manuellen Betrieb vor dem Start der neuen Version `npx prisma migrate deploy` ausführen.

## Prüfung

Matching- und API-Regressionstests decken Stammschulbeschränkung, veraltete Sammelfreigaben, atomare Zuweisungen, Schuljahresübernahme und alte/neue Sicherungen ab. Archivtests prüfen Verschlüsselung, Mandanten- und Schuljahresgrenzen sowie begrenzte Datenmengen. Die Release-Pipeline prüft zusätzlich den tatsächlichen Docker-Laufzeitbetrieb und die Wiederherstellung.
