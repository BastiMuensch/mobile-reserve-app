# v0.1.18 – Fachlehrkraft im Qualifikationsstatus

Der Qualifikationsstatus bietet jetzt **Lehrkraft – GS**, **Lehrkraft – MS**, **Fachlehrkraft** und **Drittkraft**. Die Auswahl gilt bei Registrierung, im eigenen Profil sowie beim Anlegen und Bearbeiten durch das Schulamt. Schulen sehen die Angaben bei der zugewiesenen Reserve.

**Sport unterrichten: Ja/Nein** und der gemeinsame Hinweis bleiben unverändert. Die Angaben haben weiterhin keinen Einfluss auf Zuteilung, Rangfolge oder Einsatzpräferenz.

## Bestehende Daten und Update

- „Student/in“ ist nicht mehr neu auswählbar. Bereits gespeicherte Werte bleiben als bisherige Angabe lesbar und in Sicherungen erhalten. Beim nächsten vollständigen Bearbeiten muss ein aktueller Status gewählt werden; es erfolgt keine automatische Umstufung.
- Die neue Migration erweitert nur die zulässigen Datenbankwerte um Fachlehrkraft. Bestehende Sportangaben, Konten, Einladungen, Einsätze und Mailaufträge bleiben erhalten.
- Datenbank, Domain und bestehende `.env` einschließlich `INVITATION_TOKEN_PEPPER`, `JWT_SECRET` und `SMTP_ENCRYPTION_KEY` beibehalten. Wie üblich beim Update `npx prisma migrate deploy` ausführen; der Prisma-Client wird beim Build erzeugt.
- Die Veröffentlichung aktualisiert keinen laufenden Server automatisch.

## Prüfung

Tests decken Fachlehrkraft bei Registrierung, Profilbearbeitung, Schulansicht, Schuljahresübernahme und Sicherungswiederherstellung ab. Der Migrationstest prüft zusätzlich die unveränderte Übernahme einer v0.1.17-Studentenangabe samt Sportberechtigung sowie den Fortbestand von Einladungslinks. Matching-Tests prüfen die unveränderte Zuteilung für alle aktuellen und historischen Qualifikationswerte.
