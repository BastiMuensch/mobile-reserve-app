# Projektübersicht und Wegweiser

Mit dem lokalen Code abgeglichen: 14.11.2026. Einstieg bei Orientierungsbedarf, keine Pflichtlektüre für jede Änderung.

## Architektur

- Eine Installation pro Schulamt. Aktive Webrollen: `SCHULAMT`, `SCHOOL`, `TEACHER`. Historische `ADMIN`-Datensätze ermöglichen keinen Webzugang.
- Next.js App Router und React, TypeScript, Tailwind CSS; PostgreSQL mit Prisma. Genaue Versionen und Befehle stehen in [package.json](package.json), aufgelöste Abhängigkeiten in [package-lock.json](package-lock.json).
- Eigene Cookie-/JWT-Sitzungsverwaltung mit `jose` und serverseitiger Kontoprüfung; kein NextAuth. Datenmodell: [prisma/schema.prisma](prisma/schema.prisma), Migrationen: [prisma/migrations](prisma/migrations).
- `/` zeigt Anmeldung sowie Schul- und Lehrkraft-Dashboard; das Schulamt arbeitet unter `/schulamt/*`. Profile haben eigene Routen unter `/schule` und `/lehrkraft`.
- Seiten und API-Routen: `src/app`; Komponenten: `src/components`; Fachlogik: `src/lib`; Hooks: `src/hooks`; gemeinsame Typen: `src/types`.
- Die öffentliche Website in [landing](landing/README.md) ist ein eigener Bereich. Änderungen dort verändern nicht die Anwendungs-Dashboards.

## Code-Einstiege nach Aufgabe

Die Tabelle nennt Startpunkte, keinen vollständigen Dateikatalog. Ab dort gezielt nach Symbolen und zugehörigen Tests suchen.

| Bereich | Einstieg |
|---|---|
| Anmeldung, Rollen, Sitzung | [auth.ts](src/lib/auth.ts), [webRoles.ts](src/lib/webRoles.ts), [AuthProvider.tsx](src/components/AuthProvider.tsx) |
| Schulamt-Navigation und Daten | [SchulamtLayoutClient.tsx](src/components/schulamt/SchulamtLayoutClient.tsx), [useSchulamtData.ts](src/hooks/useSchulamtData.ts) |
| Bedarf melden, ändern, beenden | [SchoolRequestForm.tsx](src/components/school/SchoolRequestForm.tsx), [requestValidation.ts](src/lib/requestValidation.ts), [requestLifecycle.ts](src/lib/requestLifecycle.ts) |
| Einzel- und Idealbesetzung | [matching.ts](src/lib/matching.ts), [batchMatching.ts](src/lib/batchMatching.ts), [assignService.ts](src/lib/assignService.ts) |
| Stunden und Auslastung | [assignmentHours.ts](src/lib/assignmentHours.ts), [workload.ts](src/lib/workload.ts) |
| Kalender und Schuljahreswechsel | [dateKey.ts](src/lib/dateKey.ts), [schoolYear.ts](src/lib/schoolYear.ts), [teacherCopy.ts](src/lib/teacherCopy.ts) |
| Mail und Geräte-Push | [emailOutbox.ts](src/lib/emailOutbox.ts), [requestEmail.ts](src/lib/requestEmail.ts), [push.ts](src/lib/push.ts) |
| Monatsmeldung und Archiv | [governmentReport.ts](src/lib/governmentReport.ts), [governmentReportService.ts](src/lib/governmentReportService.ts), [schoolYearArchiveData.ts](src/lib/schoolYearArchiveData.ts) |
| Datenschutz und Dateien | [dataRetention.ts](src/lib/dataRetention.ts), [annualDataRetention.ts](src/lib/annualDataRetention.ts), [mediaStorage.ts](src/lib/mediaStorage.ts) |
| Sicherung und Wiederherstellung | [backup.ts](src/lib/backup.ts), [fullBackup.ts](src/lib/fullBackup.ts), [FULL-BACKUP.md](FULL-BACKUP.md) |

## Dokumentation nach Anlass

| Anlass | Maßgeblicher Einstieg |
|---|---|
| Fachliche Grenzen einer Änderung | [Fachregeln](docs/FACHREGELN.md); für Qualifikationsdetails [QUALIFIKATIONEN.md](QUALIFIKATIONEN.md), für Stammschulbenachrichtigungen [STAMMSCHULEN.md](STAMMSCHULEN.md) |
| Begründung zentraler Festlegungen | [Entscheidungen](docs/ENTSCHEIDUNGEN.md) |
| Prüfungen, Testdatenbank, Rollenabläufe | [TESTPLAN.md](TESTPLAN.md) – Strategie und relevanten Ablauf lesen; alte Prüfstände sind historische Nachweise |
| Neuinstallation auf einem VPS | [INSTALLATION-VPS.md](INSTALLATION-VPS.md) |
| Schulamts-VPS und Rollout | [NETCUP-ROLLOUT.md](NETCUP-ROLLOUT.md) |
| Sicherung, Recovery oder Umzug | [FULL-BACKUP.md](FULL-BACKUP.md) |
| Offline-Schuljahresarchiv | [SCHULJAHRESARCHIV.md](SCHULJAHRESARCHIV.md) |
| Demo betreiben | [demo/ANLEITUNG.md](demo/ANLEITUNG.md), [DEMO-SEED.md](DEMO-SEED.md) |
| Konfiguration | [.env.example](.env.example), [next.config.ts](next.config.ts), zur Betriebsart passende `docker-compose*.yml`; keine echten Geheimnisse in Kontextdateien kopieren |
| Konkrete Arbeit fortsetzen | [Arbeitsstand](docs/ARBEITSSTAND.md); Zustand und Änderungen mit Git verifizieren |

## Wissen aktuell halten

- Fakten jeweils einmal pflegen: Versionen in Paketdateien, Felder im Prisma-Schema, Verhalten im Code und in Tests. Hier nur Orientierung und Verweise.
- Dauerhafte, nicht offensichtliche Gründe in den Entscheidungen festhalten; Regeln im betroffenen Fachabschnitt aktualisieren. Bei Ablösung den alten Stand ersetzen oder ausdrücklich als historisch markieren.
- Die lokale, Git-ignorierte `Task.md`, datierte Audits und Release-Notizen erklären frühere Arbeiten; sie sind keine automatisch gültige Aufgabenliste. Widersprüche zum aktuellen Code benennen und vor einer darauf beruhenden Verhaltensänderung klären.
- Änderungen dieser Referenzen zusammen mit der zugehörigen Implementierung pflegen. Ein Prüfdatum ist kein Nachweis, dass spätere Änderungen bereits berücksichtigt sind.
