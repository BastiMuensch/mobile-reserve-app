# v0.1.17 – Qualifikationsangaben für Mobile Reserven

Bei Registrierung und Profilbearbeitung geben Mobile Reserven ihren Qualifikationsstatus an: **Lehrkraft – GS**, **Lehrkraft – MS**, **Drittkraft** oder **Student/in**. Dazu kommt die Pflichtangabe **Sport unterrichten: Ja/Nein** mit einem gemeinsamen Hinweis zu Lehrbefähigung beziehungsweise Übungsleiterschein und Sichtbarkeit der Angaben.

Schulleitungen sehen diese Informationen bei der zugewiesenen Person. Das Schulamt kann sie in der Reservenübersicht und im Warteraum einsehen sowie beim Anlegen und Bearbeiten pflegen. **Die Angaben beeinflussen weder Zuteilung noch Rangfolge oder Einsatzpräferenz.**

Bestehende Reserven erhalten einen Hinweis, ihre Angaben im eigenen Profil zu ergänzen. Fehlende Angaben werden als „Noch nicht angegeben“ angezeigt; sie werden nicht automatisch als Lehrkraft oder „Sport: Nein“ eingestuft. Fächerangaben bleiben erhalten. Schuljahresübernahme und Sicherungswiederherstellung berücksichtigen die neuen Felder; alte Sicherungen bleiben importierbar.

## Update bestehender Installationen

- Zwei additive Migrationen ergänzen die Qualifikationsfelder und ihre zulässigen Werte. Bestehende Konten, Einsätze, Einladungen und Mailaufträge werden nicht verändert.
- Bereits versendete Einladungslinks bleiben unter ihrer bisherigen Ablaufzeit gültig. Der Link führt zur Registrierung mit den neuen Pflichtfeldern. Bei unvollständigen Eingaben wird die Einladung nicht eingelöst oder verbraucht.
- Bestehende Datenbank, Domain und `.env` einschließlich aller Schlüssel beibehalten. Insbesondere `INVITATION_TOKEN_PEPPER`, `JWT_SECRET` und `SMTP_ENCRYPTION_KEY` nicht neu erzeugen.
- Der reguläre Update-Ablauf führt die Migrationen aus. Bei manuellem Betrieb vor dem Start der neuen Version `npx prisma migrate deploy` ausführen und den Prisma-Client beim Build neu erzeugen.
- Dieses Release aktualisiert die Anwendung; ein Serverupdate wird weiterhin bewusst durch den Betreiber ausgeführt.

## Prüfung

Der Update-Test baut die bisherige Datenbankstruktur mit vorhandenen Konten, Einladungen, Einsätzen und Mailaufträgen auf. Nach beiden Migrationen sind die bisherigen Datensätze unverändert; aktive Einladungen lassen sich weiterhin genau einmal einlösen, abgelaufene und widerrufene bleiben ungültig. Weitere Tests prüfen Registrierung, Zugriffsschutz, Matching, Schuljahresübernahme, Sicherungen und vollständige verschlüsselte Wiederherstellung.
