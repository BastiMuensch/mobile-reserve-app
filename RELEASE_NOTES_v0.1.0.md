# v0.1.0 – Schulamts-Rollout, überarbeitete Oberfläche und Idealbesetzung

Erste stabile Veröffentlichung für eine Schulamtsinstanz pro Installation.

## Änderungen

- Überarbeitete Oberflächen für Schulamt, Schulen und mobile Reserven sowie eine neue Informations-Homepage mit aktuellen, ausschließlich synthetischen Screenshots. Das Logo bleibt erhalten.
- Ersteinrichtung mit Schulamt, Briefkopf, Unterschrift, mindestens einer Schule und optionaler Mail-Anbindung; keine regionalen Beispieldaten als Installationsvorgabe.
- Schulprofile mit getrennten Punkten für Eingang und Parkplatz. Lehrkräfte können ihren Wohnort-Pin selbst bestätigen; die vollständige Anschrift bleibt für Post und Dokumentation erhalten.
- Idealbesetzung berücksichtigt Schuljahr, verfügbare Unterrichtstage, Engpässe und Belegungskonflikte zuverlässiger. Vorschauen werden bei veränderten Grundlagen verworfen; Mehrarbeit erfordert eine ausdrückliche Bestätigung. Die Planung bleibt ein überprüfbarer heuristischer Vorschlag, keine Garantie für ein mathematisches Optimum.
- Zusätzliche Absicherung konkurrierender Zuweisungen, Abwesenheiten, Rollenrechte, Exporte, SMTP-Einstellungen und Mailaufträge.
- Bestätigungs-PDFs bilden tatsächliche Einsatztage und Stunden ab. Zugriff nur für das Schulamt und die betroffene mobile Reserve; der fachliche BayTGV-Text bleibt erhalten.
- Verbesserte Abmeldung und Aktualisierung geöffneter Ansichten. Web-Push bleibt mobilen Reserven vorbehalten; E-Mail-Benachrichtigungen bleiben davon unabhängig.
- Backup-Erweiterungen für öffentliche Einstellungen und neue Schulpunkte; informativer Update-Check anhand stabiler GitHub-Releases.

## Vor dem Update einer bestehenden Installation

1. Datenbank, öffentliche Uploads, private Unterschriften und die bestehende `.env` einschließlich aller Schlüssel sichern. Migrationen zunächst an einer geschützten Datenbankkopie prüfen. Kein `docker compose down -v` verwenden.
2. Die vorhandene Compose-Konfiguration mit der passenden Repository-Vorlage vergleichen, nicht blind überschreiben. Insbesondere `SMTP_ENCRYPTION_KEY`, `INVITATION_TOKEN_PEPPER`, `SETUP_TOKEN`, `NEXT_PUBLIC_APP_URL` und das persistente Volume `/app/private-uploads` prüfen. Bestehende Schlüssel beibehalten und Schreibrechte für den nicht privilegierten Containerbenutzer sicherstellen.
3. Den bisherigen Mailausgang prüfen: Die Migration `20260907143000_outbox_encrypted_payload_and_leases` entfernt alte Klartext-Nutzdaten. Noch offene Altaufträge werden nicht automatisch erneut versandt und müssen fachlich geklärt werden.
4. Die App führt bei Verwendung der Repository-Compose-Dateien beim Start `prisma migrate deploy` aus. Bei einem Migrationsfehler nicht wiederholt blind neu starten oder Migrationen als angewendet markieren, sondern die Ursache klären. Vorhandene aktive Doppelzuweisungen können die Schutzindex-Migration blockieren.
5. Bisher öffentliche Unterschriften mit `node scripts/migrate-private-signatures.mjs` im aktualisierten App-Container in den geschützten Speicher übernehmen. Der Compose-Service heißt je nach Vorlage `app` oder `web`; Details stehen in `DEPLOYMENT.md`.
6. Nach dem Update Anmeldung, Schulprofil, einen bestehenden PDF-Nachweis und den Mailausgang prüfen. Eingang und Parkplatz werden bewusst nicht automatisch aus alten Schulpins abgeleitet.

Ein Rückwechsel auf ein älteres Image allein ist kein vollständiger Datenbank-Rollback. Für eine Rückkehr zum vorherigen Stand die zusammengehörige Sicherung verwenden.

## Images und Prüfung

Der Release-Workflow veröffentlicht `ghcr.io/bastimuensch/mobile-reserve-app:0.1.0` und aktualisiert `:latest`. Ein normaler Push auf `main` aktualisiert nur das Entwicklungsimage. Das neue Image ist erst nach erfolgreichem Release-Workflow verfügbar.

Vor Veröffentlichung lokal bestanden: ESLint, Produktionsbuild einschließlich TypeScript, 112 Unit-/Regressionstests und 9 PostgreSQL-Integrationstests. Zusätzlich wurden die Oberflächen und die Homepage mit synthetischen Daten geprüft. Diese Prüfungen ersetzen keinen Upgrade-Probelauf mit einer Kopie der jeweiligen Bestandsdatenbank.
