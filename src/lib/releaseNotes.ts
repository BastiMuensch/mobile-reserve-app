import { parseSemVer } from './updateCheck';
import { isWebRole, type WebRole } from './webRoles';

export type ReleaseAudience = WebRole;

export interface ReleaseNotes {
  version: string;
  changes: Record<'SCHULAMT' | 'SCHOOL', readonly string[]> & { TEACHER?: readonly string[] };
}

export interface ReleaseNotice {
  version: string;
  changes: readonly string[];
}

const TEACHER_CHANGES_0_1_38 = [
  'Neue Einsätze zeigen Ihre tatsächlich eingeplanten Unterrichtsstunden und den richtigen Beginn auch bei Teilbesetzungen. Spätere Stundenplanänderungen verändern diese Angaben nicht. Bei älteren Einsätzen ohne verlässliche Stundenangabe stimmen Sie den Beginn bitte mit der Schule ab.',
  'Die Anmeldung lädt weniger Daten und startet dadurch schneller.',
  'Ihr Einsatzplan aktualisiert sich auch bei langsamen Verbindungen zuverlässig. Nach einem Tageswechsel wird der nächste Einsatz korrekt angezeigt, auch wenn die App über Nacht geöffnet bleibt.',
  'Kalendereinträge erscheinen als ganztägige Termine und nennen die Unterrichtsstunden im Text. Die konkreten Uhrzeiten stimmen Sie mit der Schule ab.',
] as const;

// Add an entry with every version bump. Keep irrelevant audiences empty; TEACHER
// may be omitted for historical releases. These notes need no GitHub access.
export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: '0.1.41',
    changes: {
      SCHULAMT: [
        'Schulen und Mobile Reserven können einen frei eingetragenen Schulamtsbezirk erhalten. Unter Einstellungen → Zuweisung lässt sich der standardmäßig ausgeschaltete Bezirksfilter aktivieren.',
        'Der Bezirksfilter verwendet ausschließlich eingetragene Bezirke und filtert Schulen, Bedarfe, Karte sowie vorgeschlagene und manuell auswählbare Mobile Reserven. Die Kennzahlen im Kopfbereich zeigen weiterhin das gesamte Schulamt.',
        'Bei der Registrierung erscheint ein Hinweis zu Art und Zweck der Datenspeicherung mit verpflichtender Bestätigung. Zeitpunkt und angezeigter Text werden gespeichert; eine geänderte Erklärung muss erneut bestätigt werden.',
        'Die Schulauswahl zeigt Schulnamen statt interner IDs. Lange Namen werden umgebrochen, Auswahllisten sind auch auf kleinen Bildschirmen scrollbar. Technische Abhängigkeiten wurden aktualisiert.',
      ],
      SCHOOL: [],
      TEACHER: [
        'Bei der Registrierung wird vor dem Absenden der Hinweis zur Datenspeicherung angezeigt und ausdrücklich bestätigt. Ein Schulamtsbezirk kann optional eingetragen werden.',
        'Die Schulauswahl zeigt lange Namen vollständig mit Zeilenumbruch und bleibt auf kleinen Bildschirmen bedienbar.',
      ],
    },
  },
  {
    version: '0.1.40',
    changes: {
      SCHULAMT: [
        'Schulen und Mobile Reserven können einen frei eingetragenen Schulamtsbezirk erhalten. Unter Einstellungen → Zuweisung lässt sich der standardmäßig ausgeschaltete Bezirksfilter aktivieren.',
        'Der Bezirksfilter verwendet ausschließlich eingetragene Bezirke und filtert Schulen, Bedarfe, Karte sowie vorgeschlagene und manuell auswählbare Mobile Reserven. Die Kennzahlen im Kopfbereich zeigen weiterhin das gesamte Schulamt.',
        'Bei der Registrierung erscheint ein Hinweis zu Art und Zweck der Datenspeicherung mit verpflichtender Bestätigung. Zeitpunkt und angezeigter Text werden gespeichert; eine geänderte Erklärung muss erneut bestätigt werden.',
        'Die Schulauswahl zeigt Schulnamen statt interner IDs. Lange Namen werden umgebrochen, Auswahllisten sind auch auf kleinen Bildschirmen scrollbar.',
      ],
      SCHOOL: [],
      TEACHER: [
        'Bei der Registrierung wird vor dem Absenden der Hinweis zur Datenspeicherung angezeigt und ausdrücklich bestätigt. Ein Schulamtsbezirk kann optional eingetragen werden.',
        'Die Schulauswahl zeigt lange Namen vollständig mit Zeilenumbruch und bleibt auf kleinen Bildschirmen bedienbar.',
      ],
    },
  },
  {
    version: '0.1.39',
    changes: {
      SCHULAMT: [
        'Bedarfe und Idealbesetzung zeigen die angefragten Stunden je Wochentag. Ausgewählte Vorschläge bleiben bei einer Neuberechnung erhalten; Absagen lassen sich gezielt für einzelne Tage bearbeiten. Die Berechnung großer Pläne ist deutlich schneller.',
        'Neue Zuweisungen speichern die belegten Unterrichtsstunden. Mobile Reserven sehen auch bei Teilbesetzungen den richtigen Beginn; bei älteren Einsätzen ohne verlässliche Stundenangabe wird um Abstimmung gebeten. Schulen sehen konkrete Einsatzstunden sowie direkte Telefon- und E-Mail-Links.',
        'Rückkehrmeldungen berücksichtigen den angegebenen letzten Einsatztag. Stundenpläne werden beim Speichern genauer geprüft; Kalenderdateien enthalten die Unterrichtsstunden im Text und den Einsatz als ganztägigen Termin.',
        'Die Anmeldung lädt weniger Daten. Übersichten aktualisieren sich auch bei langsamen Verbindungen zuverlässig; Tageswechsel und Wechsel des Schuljahres werden korrekt berücksichtigt.',
      ],
      SCHOOL: [
        'Bei neuen Zuweisungen werden die tatsächlich belegten Unterrichtsstunden gespeichert und den Mobilen Reserven als Einsatzbeginn angezeigt. Spätere Änderungen am Stundenplan verändern diese Angaben nicht.',
        'Rückkehrmeldungen richten sich nach dem angegebenen letzten Einsatztag. Bedarfe und Nachrichten zeigen die Unterrichtsstunden passend zum jeweiligen Wochentag.',
        'Die Anmeldung startet mit weniger Daten; Ihre Übersicht aktualisiert sich auch bei langsamen Verbindungen zuverlässig. Kalendereinträge enthalten die Unterrichtsstunden im Text und erscheinen als ganztägige Termine.',
        'Ihre Bedarfsübersicht zeigt bei Zuweisungen jetzt die konkreten Unterrichtsstunden. Über direkte Telefon- und E-Mail-Links erreichen Sie die zugewiesene Mobile Reserve.',
      ],
      TEACHER: TEACHER_CHANGES_0_1_38,
    },
  },
  {
    version: '0.1.38',
    changes: {
      SCHULAMT: [
        'Bedarfe und Idealbesetzung zeigen die angefragten Stunden je Wochentag. Ausgewählte Vorschläge bleiben bei einer Neuberechnung erhalten; Absagen lassen sich gezielt für einzelne Tage bearbeiten. Die Berechnung großer Pläne ist deutlich schneller.',
        'Neue Zuweisungen speichern die tatsächlich belegten Unterrichtsstunden. Mobile Reserven sehen dadurch auch bei Teilbesetzungen den richtigen Beginn. Bei älteren Einsätzen ohne verlässliche Stundenangabe wird um Abstimmung mit der Schule gebeten.',
        'Rückkehrmeldungen berücksichtigen den angegebenen letzten Einsatztag. Stundenpläne werden beim Speichern genauer geprüft; Kalenderdateien enthalten die Unterrichtsstunden im Text und den Einsatz als ganztägigen Termin.',
        'Die Anmeldung lädt weniger Daten. Übersichten aktualisieren sich auch bei langsamen Verbindungen zuverlässig; Tageswechsel und Wechsel des Schuljahres werden korrekt berücksichtigt.',
      ],
      SCHOOL: [
        'Bei neuen Zuweisungen werden die tatsächlich belegten Unterrichtsstunden gespeichert und den Mobilen Reserven als Einsatzbeginn angezeigt. Spätere Änderungen am Stundenplan verändern diese Angaben nicht.',
        'Rückkehrmeldungen richten sich nach dem angegebenen letzten Einsatztag. Bedarfe und Nachrichten zeigen die Unterrichtsstunden passend zum jeweiligen Wochentag.',
        'Die Anmeldung startet mit weniger Daten; Ihre Übersicht aktualisiert sich auch bei langsamen Verbindungen zuverlässig. Kalendereinträge enthalten die Unterrichtsstunden im Text und erscheinen als ganztägige Termine.',
      ],
      TEACHER: TEACHER_CHANGES_0_1_38,
    },
  },
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
  if (!isWebRole(role)) return null;
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
