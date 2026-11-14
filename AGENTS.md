# Mobile Reserve

Vertretungsplanung für Schulen, Schulamt und Mobile Reserven. Eine Installation verwaltet ein Schulamt.
Next.js App Router, React, TypeScript, Tailwind CSS, Prisma/PostgreSQL; Paketverwaltung: npm.

## Arbeitsweise

- Änderungen gezielt halten, vorhandene Muster nutzen, fremde Änderungen bewahren.
- Fachlogik in `src/lib`, UI in `src/components`; gemeinsame Bausteine aus `src/components/ui` nutzen. Oberfläche deutsch, mobil bedienbar und barrierearm halten.
- Rollen und Ressourcenzugehörigkeit serverseitig prüfen, Eingaben validieren. Keine Geheimnisse oder personenbezogenen Daten in Logs oder Git.
- Bei Fachlogik die betroffenen Regeln unten nachlesen; Transaktionsschutz, Kalenderlogik und Datenkompatibilität erhalten.
- Bei Codeänderungen `npm run check` und die passenden Zusatzprüfungen aus [TESTPLAN.md](TESTPLAN.md) ausführen. Reine Dokumentation: Diff und Verweise prüfen. Fehlende oder übersprungene Prüfungen nennen.

## Kontext gezielt laden

Nur zur Aufgabe passende Abschnitte lesen; keine vollständige Dokumentationsrunde bei jedem Chatstart.

| Anlass | Referenz |
|---|---|
| Architektur, Code-Einstieg oder Betriebsdokumentation finden | [CONTEXT.md](CONTEXT.md) |
| Planung, Stunden, Rollen, Datenschutz oder Datenmodell ändern | [Fachregeln](docs/FACHREGELN.md) |
| Bestehende Grundsatzentscheidung hinterfragen | [Entscheidungen](docs/ENTSCHEIDUNGEN.md) |
| Unterbrochene Arbeit fortsetzen | [Arbeitsstand](docs/ARBEITSSTAND.md) |

Bei Änderungen die betroffene Referenz aktualisieren. Dauerhafte Erkenntnisse dort festhalten; offene Arbeit knapp im Arbeitsstand übergeben. Keine Chatprotokolle, vollständigen Logs oder Codeduplikate ablegen.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
