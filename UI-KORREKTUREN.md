# UI-Korrekturblock – 13.09.2026

## Umfang

- Schul-Dashboard: Karten/Tabelle richten sich nach der tatsächlichen Listenbreite
  (Container Query), nicht mehr nach der Fensterbreite. Unter 56 rem bleibt die
  Kartenansicht erhalten. Texte können umbrechen; lange Namen überdecken keine Aktionen.
- Karten und Tabelle verwenden dieselben Aktions-, Umfangs- und Hinweisbausteine.
  Wochenstunden, Beginn, Hinweise und Abschlussdatum bleiben sichtbar bzw. abrufbar.
  Hinweise sind nun auch auf Touch-Geräten und per Tastatur zugänglich.
- Das Rechte-/Statusverhalten bleibt erhalten: Stornieren nur bei ausstehenden,
  nicht archivierten Anfragen; Rückkehr nur bei laufenden offenen Anfragen.
- Statistikdiagramme werden erst mit tatsächlich gemessenen, positiven Abmessungen
  gerendert. ResizeObserver aktualisiert die Größe und entfernt Diagramme bei 0 px.
  Die bisherigen Anfangswerte -1 × -1 gelangen nicht mehr zu Recharts.
- Logo, Schriftarten, globale Farben, Diagrammdaten und serverseitige Abläufe sind unverändert.

## Prüfung

- `npm run check`: Lint, TypeScript, 137 erfolgreiche Tests und Produktions-Build.
  Acht datenbankabhängige Tests werden ohne TEST_DATABASE_URL erwartungsgemäß
  übersprungen; für diesen reinen UI-Block wurde keine Datenbank verändert.
- Sechs neue Regressionstests für Chartabmessungen und die Darstellung/Verfügbarkeit
  von Anfrageaktionen, Archiv und Ladezustand.
- Lokaler Browser-Test mit tatsächlichen Komponenten und ausschließlich erfundenen
  Daten bei 320, 390, 768, 1024 und 1440 px: kein Seitenüberlauf und keine seitlich
  abgeschnittenen Aktionsbuttons. Engste Tabellenansicht zusätzlich auf Zellüberlauf geprüft.
- Karten- und Tabellenansicht, helle/dunkle Darstellung, Hinweis-Popover,
  Aktionszuordnung über Test-Callbacks und Archiv ohne Schreibaktionen geprüft.
- Diagramme bei Größenwechsel sowie Aus-/Einblenden und leerem Datenbestand geprüft;
  keine Konsolenwarnungen oder -fehler in der lokalen Testseite beobachtet.

## Reproduzierbare lokale Vorschau

Nach `npm ci`: `node scripts/preview-ui-regressions.mjs` starten und
http://127.0.0.1:3137 öffnen. Nach Quellcodeänderungen den Vorschauprozess neu starten
und die Seite neu laden. Die Vorschau bindet ausschließlich an localhost und
beantwortet keine schreibenden API-Aufrufe. Sie ist keine neue Route der Anwendung.

## Nicht Bestandteil

Keine Änderungen an Live-Daten, Impressum/Datenschutz, Schul-Pins, Zugangsdaten,
Abhängigkeiten, Datenbankschema oder Deployment. Ein Git-Push allein aktualisiert
keine laufende Installation. Echte Mail-/Push-Zustellung und PDF-Downloads
sind durch diese UI-Prüfung nicht erneut verifiziert.
