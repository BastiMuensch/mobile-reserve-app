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
