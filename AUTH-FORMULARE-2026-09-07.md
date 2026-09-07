# Öffentliche Registrierung und Passwortreset

## Ursache und Änderung

Der zentrale Client-Handler für HTTP 401 leitete bisher jede Seite außer `/` zur Anmeldung um. Dadurch verwarf schon die erwartete anonyme Antwort von `/api/auth/me` die URLs der öffentlichen Formulare einschließlich ihres Tokens.

`src/lib/authClient.ts` nimmt jetzt ausschließlich die exakten Seitenpfade `/`, `/register/teacher` und `/reset` von der Weiterleitung aus. Das Ereignis `auth-invalidated` wird weiterhin bei jedem 401 ausgelöst. Geschützte Seiten leiten weiterhin genau einmal nach `/` um. Keine Präfixfreigabe, keine Änderung an Proxy, APIs, Berechtigungen, Tokenvalidierung oder Mailversand.

## Prüfung

- 128 Unit-/Regressionstests bestanden, keine Fehler; sieben datenbankabhängige Integrationstests im allgemeinen Unit-Lauf übersprungen.
- Acht zusätzliche Regressionstests für öffentliche Formularpfade, Sitzungsinvalidierung, spätere Weiterleitung geschützter Seiten und nicht freigegebene ähnlich benannte Pfade.
- Lint und Produktionsbuild einschließlich TypeScript erfolgreich.
- 91 UI-Prüfungen erneut erfolgreich; der bisherige Auth-Mock für öffentliche Formulare ist entfernt. Einladungs-/Einrichtungsdaten werden im reinen Layoutcheck weiterhin simuliert.
- `scripts/check-public-auth.mjs` gegen die lokale synthetische Testdatenbank erfolgreich, ohne Auth-/API-Mocks:
  - Echte Einladung über die API bei deaktiviertem Mailversand erzeugt.
  - Anonymer Direktaufruf behält Token nach realem 401 und löscht den Sitzungszustand.
  - Registrierung vollständig im Browser ausgefüllt und abgesendet; Konto landet im Warteraum.
  - Verbrauchte und abgelaufene Einladungen bleiben unbrauchbar; fehlende Tokens zeigen die Formularfehlermeldung.
  - Für ausschließlich das neu angelegte Testkonto einen gehashten Reset-Testtoken in der Testdatenbank vorbereitet; echte Passwortänderung über das Browserformular erfolgreich. Neues Passwort geprüft, Sitzungsversion erhöht, Warteraumstatus unverändert.
  - Erneute Nutzung desselben Reset-Links wird abgewiesen; Fehler bleibt auf der Formularseite sichtbar.
  - Cookies im geöffneten Schulamtsportal entfernt: nach 401 Weiterleitung zur Anmeldung. Anonyme geschützte Direktaufrufe und API-Zugriffe weiterhin gesperrt.
  - Keine Browser-Laufzeitfehler. Nur die eigens erzeugten Testkonten, Profile und Tokens anschließend entfernt; bestehende Testdaten unverändert.

## Wiederholen

`TEST_DATABASE_URL` muss ausdrücklich auf die lokale synthetische Testdatenbank zeigen; `UI_TEST_BASE_URL` auf die zugehörige lokale App. Das Skript gleicht die Schulamts-ID zwischen API und Datenbank ab und verlangt `mailProvider=NONE`. `PLAYWRIGHT_MODULE` ist der absolute Pfad zur installierten Playwright-`index.mjs`.

Aufruf: `node scripts/check-public-auth.mjs` mit diesen Umgebungsvariablen. Erwartet die synthetischen `ui-test.local`-Fixtures. Mailzustellung ist nicht Teil dieses Tests; der Reset-Token wird ausschließlich als Testvorbereitung erzeugt.

## Veröffentlichung

Dieser Fix entstand nach Release 0.1.5 und ist darin nicht enthalten. Der Nutzer hat Commit, Push und Veröffentlichung als Release 0.1.6 freigegeben. Der erfolgreiche Abschluss des anschließenden Container-Builds ist separat zu kontrollieren.
