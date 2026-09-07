# Statische Homepage

Aktualisiert am 7. September 2026. Die Homepage erklärt Einzelzuweisung, Idealbesetzung, Rollen, Einrichtung, Benachrichtigungen und Betrieb. Das vorhandene Logo und die Inhalte der rechtlichen Unterseiten bleiben erhalten.

## Veröffentlichen

Benötigt werden ausschließlich `index.html`, `style.css`, `impressum.html`, `datenschutz.html` und die eingebundenen Bilder im Ordner `img/`. Diese Struktur unverändert auf den Webspace kopieren. Es ist kein Node.js-Server für die Homepage nötig.

Nicht veröffentlichen: `node_modules/`, Skripte, Paketdateien oder Testzugänge. Vor dem Hochladen Kontaktadressen, Demo-Angebot und rechtliche Unterseiten prüfen. Es wurden keine externen Schriften, Analyse-Dienste oder Tracking-Skripte ergänzt. Die eingebetteten Screenshots sind lokale Bilder; sie laden keine Live-Karten nach.

Die Bildschirmfotos öffnen sich über ihre Bildlinks in einem neuen Tab. Sie stammen aus der echten Anwendung mit synthetischen Testdaten, nicht aus einer produktiven Dienststelle. Ein UI-Test-Name im Bild ist daher beabsichtigt. Die Bilder enthalten keine neuen Stockfotos oder KI-erzeugten Personenbilder.

## Bildschirmfotos erneuern

`npm run screenshots` nutzt `capture.mjs` und ausschließlich die ausdrücklich ausgewählte lokale synthetische Testinstanz:

```sh
APP_URL=http://127.0.0.1:3118 SCREENSHOT_FIXTURE=ui-test-20260907 npm run screenshots
```

Die Testinstanz muss separat mit der synthetischen Datenbank und abgeschaltetem E-Mail-/Bereinigungs-Scheduler laufen. Das Aufnahmeskript legt keine Testdaten an, ändert keine Profile und gibt keine Zuweisungen frei. Es ersetzt sechs PNG-Bilder im Ordner `img/`. Die alten WebP-Aufnahmen bleiben als bisherige Arbeitsdateien erhalten, sind aber nicht mehr in der Homepage eingebunden.

## Prüfung

Die Homepage lokal statisch bereitstellen und aus dem Projektstamm ausführen:

```sh
LANDING_URL=http://127.0.0.1:3119 PLAYWRIGHT_MODULE=/absoluter/pfad/playwright/index.mjs node scripts/check-landing.mjs
```

Geprüft werden Bilddateien, Abschnittslinks, FAQ, Tastaturbedienung des mobilen Menüs, Desktop-/Tablet-/Mobilansichten, dunkler Modus und erreichbare rechtliche Unterseiten. Die Ergebnisbilder liegen unter `output/landing-audit/`.
