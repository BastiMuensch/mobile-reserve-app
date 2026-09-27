# Schuljahresarchiv: Unterlagen exportieren und getrennt aufbewahren

Das Schulamt kann unter **Dokumentation → Abrechnung & Nachweise** ein Paket für das oben ausgewählte Schuljahr herunterladen. Das Paket dokumentiert den beim Export verfügbaren Datenstand. Es ist kein Vollbackup, kein Nachweis einer erfolgten Übermittlung an die Regierung und keine Garantie für die Vollständigkeit früherer Unterlagen.

## Erstellen

1. Das gewünschte Schuljahr auswählen und „Schuljahresarchiv“ öffnen.
2. Hinweise zu Datenstand und Grenzen lesen und das aktuelle Anmeldepasswort bestätigen.
3. Nach der Erstellung die angezeigten Zahlen und Warnungen prüfen.
4. Das neu erzeugte Archivpasswort im dienstlich zugelassenen Passwortmanager oder an einem anderen getrennten, geschützten Ort sichern. Die App bewahrt es nicht dauerhaft auf.
5. Die Bestätigung zur Passwortsicherung setzen und die verschlüsselte ZIP-Datei herunterladen. Den erfolgreichen Download und die Lesbarkeit prüfen, bevor der Dialog geschlossen wird.

Der Export versendet keine E-Mails, verändert keine Fachdaten und löscht nichts. Er setzt insbesondere nicht das Datum eines erfolgreichen Vollbackups. Ein gestarteter Download beweist nicht, dass das Paket in der vorgesehenen behördlichen Ablage angekommen ist.

## Ohne App öffnen

Eine Archivsoftware mit Unterstützung für AES-256-verschlüsselte ZIP-Dateien verwenden. Nicht jedes integrierte Betriebssystem-Entpackprogramm unterstützt diese Verschlüsselung. Es ist kein Terminal und kein laufender MobileReserve-Server erforderlich.

1. Die heruntergeladene ZIP-Datei öffnen und das getrennt verwahrte Archivpasswort eingeben.
2. Die darin enthaltene `Archivinhalt.zip` in einen geschützten Arbeitsordner entpacken.
3. Diese zweite, normale ZIP-Datei entpacken und `Inhaltsverzeichnis.html` im Browser öffnen. Alle Links sind lokal; es werden keine externen Inhalte benötigt.

Die zweite ZIP-Datei und die daraus entpackten Dokumente sind **nicht mehr verschlüsselt**. Sie dürfen nur in der dafür vorgesehenen, zugriffsgeschützten Ablage verbleiben. Temporäre Arbeitskopien nach den behördlichen Vorgaben entfernen. Passwort und verschlüsseltes Original getrennt verwahren.

Die doppelte Verpackung ist beabsichtigt: Die äußere ZIP-Datei verrät nur den neutralen Namen `Archivinhalt.zip`, nicht die Namen der Lehrkräfte oder einzelnen Dokumente.

## Inhalt und fachliche Grenzen

- `Jahresuebersicht.xlsx`: vorhandene Bedarfe und Einsätze im Schuljahr, einschließlich Status und Stornierungen. Stornierte Zuweisungen zählen nicht zu aktiven Stunden.
- `Monatsmeldungen/`: zuletzt gespeicherte und freigegebene Meldungen des Schuljahrs. Fehlende bzw. ungeprüfte Meldungen werden im Prüfbericht ausgewiesen, nicht nachträglich als historische Meldungen erfunden. Mehrere gespeicherte Stichtage eines Monats können enthalten sein. Die App kennt keinen verbindlichen Versandnachweis und keine vollständige Änderungshistorie.
- `Einsatznachweise/`: neu erzeugte PDF-Ausfertigungen aus dem aktuellen Datenstand. Zusammenhängende Einsatzserien werden nicht pro Einsatztag mehrfach ausgegeben. Offene Bestätigungen und Stornierungen sind gekennzeichnet; jahresübergreifende Serien werden auf das ausgewählte Jahr begrenzt. Diese PDFs ersetzen keine früher aufbewahrten Originalfassungen.
- `Inhaltsverzeichnis.html`: lesbare Übersicht, Dateilinks und Hinweise.
- `Pruefbericht.json`: maschinenlesbarer Datenstand, Dateigrößen, Prüfsummen und bekannte Grenzen. Prüfsummen dienen dem Abgleich von Dateien, sind aber keine qualifizierte Signatur oder unabhängiger Zeitstempel.

PDFs verwenden den beim Export geprüften aktuellen Briefkopf und die aktuelle Unterschrift. Änderungen gegenüber früher ausgestellten Dokumenten werden nicht rückwirkend rekonstruiert. Bereits gelöschte Bedarfe und Zuweisungen sind nicht wiederherstellbar; die Zahl solcher fehlenden Unterlagen kann die App nicht zuverlässig ermitteln. Auch gelöschte Freitexte bleiben gelöscht. Daher wird ein Paket nicht pauschal als „vollständig“ bezeichnet.

Aufbewahrungsfristen, Übernahme in die maßgebliche Aktenführung und gegebenenfalls archivrechtliche Verfahren legt die zuständige Behörde fest. Export und Aufbewahrungskonzept sind getrennte Aufgaben. Die bisherige automatische Bereinigung bleibt unverändert; ein einmaliger Jahresexport garantiert nicht die Sicherung von Angaben, die schon nach 30 Tagen entfernt werden.

## Technischer Betrieb

Zugriff ausschließlich für das Schulamt nach erneuter Passwortprüfung und Prüfung des Anfrageursprungs. Pro Benutzer/IP gilt eine Versuchsbegrenzung, pro Serverprozess wird nur ein Archiv gleichzeitig erstellt. Datenbankabfragen, Dateizahl und Gesamtgröße sind begrenzt. Bei technischen Erstellungsfehlern wird kein Teilarchiv heruntergeladen; bekannte fachliche Datenlücken stehen dagegen ausdrücklich im Bericht.

Die Erstellung erfolgt im Arbeitsspeicher, ohne unverschlüsselte temporäre Archivdateien. Das Paket enthält keine Konto-Passwort-Hashes, SMTP-Passwörter, Umgebungsvariablen oder separaten Schlüsseldateien. Erforderliche personenbezogene Dokumentdaten und eingebettete Unterschriften bleiben selbstverständlich schutzbedürftig.

Die konsistente Datenbankaufnahme wird lesend erstellt. Konfigurierte Bilddateien werden einmal eingelesen und geprüft; alle PDFs verwenden dieselben erfassten Bilddaten, auch wenn jemand währenddessen ein neues Logo hochlädt. Fehlende oder ungültige konfigurierte Bilder führen zum Abbruch. Fachliche Exporte bleiben unabhängig vom `.mrbackup`-Wiederherstellungsformat. Für Umzug und Wiederherstellung weiterhin das Vollbackup verwenden.

Die erste Ausbaustufe erlaubt bis zu 2.000 Bedarfe, 50.000 Zuweisungen, 24 gespeicherte Meldungen und 2.000 PDF-Nachweise je Paket. Quelldaten sind vor dem Laden auf 16 MiB und die unkomprimierten Ausgabedateien insgesamt auf 32 MiB begrenzt. Die Speicherbelegung während der Verarbeitung ist höher als die reine Dateigröße, weil ZIP-Erstellung und Verschlüsselung Zwischenpuffer benötigen. Bei Überschreitung gibt es eine klare Fehlermeldung statt eines abgeschnittenen Exports; größere Instanzen benötigen gegebenenfalls eine spätere gestreamte Exportvariante.
