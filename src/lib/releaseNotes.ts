import { parseSemVer } from './updateCheck';

export type ReleaseAudience = 'SCHULAMT' | 'SCHOOL';

export interface ReleaseNotes {
  version: string;
  changes: Record<ReleaseAudience, readonly string[]>;
}

export interface ReleaseNotice {
  version: string;
  changes: readonly string[];
}

// Add an entry with every version bump. Keep SCHOOL empty when a release does
// not affect schools. These notes ship with the app and need no GitHub access.
export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: '0.1.37',
    changes: {
      SCHULAMT: [
        'Die Übersicht zeigt wieder farbige Kennzahlenkarten. Die Karte mit Reserven und Schulen ist standardmäßig geöffnet und lässt sich weiterhin vergrößern.',
        'Besetzte Bedarfe und Tage ohne Reserve zeigen heute und die sechs vorherigen Tage; laufende und kommende Einsätze bleiben sichtbar. Ältere Einträge finden Sie im separaten Archiv. Durch die neue Ansichtsgrenze werden keine Daten gelöscht.',
        'Passende Reserven erscheinen direkt beim ausgewählten Bedarf. Navigation, Schulverwaltung, Zuweisungsdialoge und Bedienelemente sind übersichtlicher und auf kleinen Bildschirmen leichter zu bedienen.',
        'Die Einstellungen sind nach Zuweisung, Dokumenten und Benachrichtigungen gegliedert. Jeder Bereich wird separat gespeichert; Entwürfe in anderen Bereichen bleiben erhalten.',
      ],
      SCHOOL: [
        'Die Übersicht „Unsere Bedarfe“ bietet mehr Platz für Ihre Meldungen. Neue Anfragen öffnen Sie über „Bedarf melden“ in einem eigenen Dialog; vor dem Verwerfen ungespeicherter Angaben wird nachgefragt.',
        'Eingabefelder, Stundenplanauswahl und Schaltflächen lassen sich auf kleinen Bildschirmen leichter bedienen.',
      ],
    },
  },
  {
    version: '0.1.36',
    changes: {
      SCHULAMT: [
        'Aus 0.1.35: „Mangel an Reserven“ in den Einstellungen schließt bei neuen Einzelzuweisungen und der Idealbesetzung Tagesbedarfe auch mit kürzeren Einsätzen ab. Reststunden werden abgesagt und der Schule mitgeteilt. Der Modus bleibt bis zum bewussten Ausschalten und Speichern aktiv.',
        'Aus 0.1.35: Krankmeldungen und andere Abwesenheiten gelten auch bei der manuellen Auswahl. Außerhalb regulärer Einsatztage ist eine ausdrücklich bestätigte manuelle Zuweisung möglich; diese Ausnahmen erscheinen nicht in den Empfehlungen.',
        'Aus 0.1.35: Mehrtagesanfragen rutschen zum nächsten offenen Tag, etwa von Montag auf Mittwoch, wenn Montag und Dienstag besetzt sind. Der ursprüngliche Zeitraum bleibt sichtbar.',
        'Neu: Schulen ohne allgemeine Profilhinweise sehen auf ihrer Übersicht „Ergänzen Sie Ihr Schulprofil“ mit direktem Link. So können sie Informationen zur Anmeldung vor Ort und zu Unterrichtszeiten für Mobile Reserven hinterlegen.',
      ],
      SCHOOL: [
        'Neu: Fehlen allgemeine Hinweise im Schulprofil, erinnert Ihre Übersicht mit „Ergänzen Sie Ihr Schulprofil“ daran. Der direkte Link führt zur Eingabe von Informationen zur Anmeldung vor Ort und zu Unterrichtszeiten für Mobile Reserven.',
        'Aus 0.1.35: Bei Reservemangel kann Ihr Schulamt einen Tagesbedarf mit einem kürzeren Einsatz abschließen. Abgesagte Reststunden stehen in der Zuweisungs-E-Mail und der Einsatzübersicht. Weitere offene Tage bleiben bestehen.',
      ],
    },
  },
  {
    version: '0.1.35',
    changes: {
      SCHULAMT: [
        'Unter „Einstellungen“ können Sie „Mangel an Reserven“ aktivieren. Bei neuen Einzelzuweisungen und der Idealbesetzung schließen auch kürzere Einsätze den Tagesbedarf ab; übrige Stunden werden abgesagt und der Schule mitgeteilt.',
        'Krankmeldungen und andere Abwesenheiten werden auch bei der manuellen Auswahl zuverlässig berücksichtigt.',
        'Außerhalb regulärer Einsatztage sind Reserven mit ausdrücklicher Bestätigung manuell zuweisbar. In den Empfehlungen erscheinen diese Ausnahmen nicht.',
        'Mehrtagesanfragen werden nach ihrem nächsten offenen Tag einsortiert: Sind etwa Montag und Dienstag besetzt, erscheint die Anfrage bei Mittwoch. Der ursprüngliche Zeitraum bleibt sichtbar.',
      ],
      SCHOOL: [
        'Bei Reservemangel kann Ihr Schulamt einen Tagesbedarf mit einem kürzeren Einsatz abschließen. Über abgesagte Reststunden informiert die Zuweisungs-E-Mail; sie sind auch in der Einsatzübersicht erkennbar. Weitere offene Tage bleiben bestehen.',
      ],
    },
  },
  {
    version: '0.1.34',
    changes: {
      SCHULAMT: [
        'Die Schulübersicht merkt sich die gewählte Sortierung „Prio“ oder „Datum“ im jeweiligen Browser, auch nach dem Neuladen.',
      ],
      SCHOOL: [
        'Ihre gewählte Sortierung „Prio“ oder „Datum“ bleibt in diesem Browser jetzt auch nach dem Neuladen erhalten.',
      ],
    },
  },
  {
    version: '0.1.33',
    changes: {
      SCHULAMT: [
        'Schulen können ihre aktiven und ausstehenden Anfragen jetzt über „Prio“ und „Datum“ entweder nach Priorität gruppieren oder nach Einsatzbeginn aufsteigend sortieren.',
      ],
      SCHOOL: [
        'In Ihrer Bedarfsübersicht wechseln Sie mit „Prio“ und „Datum“ zwischen der Gruppierung nach Priorität und der Sortierung nach Einsatzbeginn. Die Statusfilter funktionieren in beiden Ansichten.',
      ],
    },
  },
  {
    version: '0.1.32',
    changes: {
      SCHULAMT: [
        'Klassenangaben und Absagebegründungen werden nun ebenfalls 30 Tage nach Abschluss eines Bedarfs entfernt. Einsatzdaten, Absagetage und Stundenstatistiken bleiben bis zur regulären Löschung erhalten.',
        'Die automatische Bereinigung erfasst ungenutzte Uploads zuverlässiger. Fehlgeschlagene Dateilöschungen werden erneut versucht; ein Lauf gilt erst nach vollständiger Bereinigung als erfolgreich.',
      ],
      SCHOOL: [
        'Klassenangaben und Absagebegründungen abgeschlossener Bedarfe werden nach 30 Tagen automatisch entfernt. Einsatzdaten und Absagetage bleiben bis zur regulären Löschung erhalten.',
      ],
    },
  },
  {
    version: '0.1.31',
    changes: {
      SCHULAMT: [
        'Die Dringlichkeitsnachricht ist standardmäßig deaktiviert. Unter „Einstellungen“ können Sie die Eingabe für Ihre Schulen freischalten. Der Updatehinweis für Schulen erwähnt diese optionale Funktion nicht.',
        'Vorschläge und Idealbesetzung berücksichtigen auch Reserven mit weniger verfügbaren Stunden. Umfangreichere Tagesbedarfe erhalten bei der Dringlichkeit mehr Gewicht.',
        'Vollständig versorgte mehrtägige Bedarfe gelten als erledigt. Unter „Besetzte Bedarfe“ sehen Sie auch Teilbesetzungen, ausstehende Bestätigungen und die zu vertretende Lehrkraft.',
        'Der Beginn laut Stundenplan, etwa ab der 3. Stunde, erscheint jetzt für jeden Einsatztag korrekt bei den Mobilen Reserven sowie in Einsatznachrichten und Kalendereinträgen.',
      ],
      SCHOOL: [
        'Der angegebene Unterrichtsbeginn wird den Mobilen Reserven nun auch bei mehrtägigen Bedarfen für jeden Einsatztag korrekt angezeigt.',
      ],
    },
  },
  {
    version: '0.1.30',
    changes: {
      SCHULAMT: [
        'Die Dringlichkeitsnachricht ist standardmäßig deaktiviert. Unter „Einstellungen“ können Sie die Eingabe für Ihre Schulen freischalten.',
        'Vorschläge und Idealbesetzung berücksichtigen auch Reserven mit weniger verfügbaren Stunden. Umfangreichere Tagesbedarfe erhalten bei der Dringlichkeit mehr Gewicht.',
        'Vollständig versorgte mehrtägige Bedarfe gelten als erledigt. Unter „Besetzte Bedarfe“ sehen Sie auch Teilbesetzungen, ausstehende Bestätigungen und die zu vertretende Lehrkraft.',
        'Der Beginn laut Stundenplan, etwa ab der 3. Stunde, erscheint jetzt für jeden Einsatztag korrekt bei den Mobilen Reserven sowie in Einsatznachrichten und Kalendereinträgen.',
      ],
      SCHOOL: [
        'Die zusätzliche Dringlichkeitsnachricht bei Bedarfsmeldungen ist nur sichtbar, wenn Ihr Schulamt sie freigeschaltet hat.',
        'Der angegebene Unterrichtsbeginn wird den Mobilen Reserven nun auch bei mehrtägigen Bedarfen für jeden Einsatztag korrekt angezeigt.',
      ],
    },
  },
  {
    version: '0.1.29',
    changes: {
      SCHULAMT: [
        'Bei längerfristigen Bedarfen zeigen und berücksichtigen die Besetzungsvorschläge, wer in der Vorwoche bereits in derselben Klasse eingeplant war.',
        'Unter „Stunden & Statistik“ sehen Sie geplante Unterrichtsstunden je Reserve nach Woche, Monat und Schuljahr. Die Auswertung lässt sich als CSV herunterladen; sie erfasst keine tatsächlich geleistete Arbeitszeit.',
        'Zuweisungen, Wochenstunden, Stornierungen und Kontowechsel wurden korrigiert. Navigation und mobile Ansichten sind übersichtlicher.',
      ],
      SCHOOL: [
        'Bei Bedarfen können Sie jetzt eine Klasse oder Lerngruppe angeben. Mit einer einheitlichen Bezeichnung kann das Schulamt frühere Einsätze bei längerfristigen Besetzungen berücksichtigen.',
        'Die Klassenangabe ist in der Bedarfsübersicht und im Einsatzplan der zugewiesenen Lehrkraft sichtbar. Der Wechsel zwischen Konten wurde verbessert.',
      ],
    },
  },
  {
    version: '0.1.28',
    changes: {
      SCHULAMT: [
        'Schulen können bei besonders dringenden Bedarfen eine Begründung für das Schulamt ergänzen. Sie ist in der Bedarfsübersicht und der Idealbesetzung sichtbar.',
        'Nach Updates informiert ein kurzer Hinweis über die neue Version und ihre Änderungen. Schulen erhalten nur für sie relevante Informationen.',
      ],
      SCHOOL: [
        'Bei besonders dringenden Bedarfen können Sie jetzt eine Begründung für das Schulamt ergänzen. Diese wird nicht an die Lehrkräfte weitergegeben.',
        'Nach Updates sehen Sie einmalig die neue Version und die Änderungen, die Ihre Schule betreffen.',
      ],
    },
  },
];

export function getReleaseNotice(
  installedVersion: string,
  role: string,
  releases: readonly ReleaseNotes[] = RELEASE_NOTES,
): ReleaseNotice | null {
  if (role !== 'SCHULAMT' && role !== 'SCHOOL') return null;
  const parsed = parseSemVer(installedVersion);
  if (!parsed) return null;
  // Development/prerelease images carry the same changes as their base version,
  // but display and acknowledge their actual installed version separately.
  const baseVersion = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  const release = releases.find(entry => entry.version === baseVersion);
  const changes = release?.changes[role];
  if (!changes?.length) return null;
  return { version: installedVersion.trim().replace(/^v/, ''), changes };
}

export function releaseSeenKey(userId: string, version: string): string {
  return `installed-release-seen:${userId}:${version}`;
}
