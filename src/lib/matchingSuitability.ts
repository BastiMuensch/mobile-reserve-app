/** Structured teaching requirements take precedence over historic free-text labels. */
export type TeachingRequirements = {
  requestedSchoolType?: string | null;
  gradeLevel?: number | null;
  requiredSubject?: string | null;
  schoolType?: string | null;
  qualifications?: string | null;
};

export type TeachingProfile = {
  qualificationType?: string | null;
  qualifications?: string | null;
  canTeachSports?: boolean | null;
};

export type MatchSuitability = {
  level: 'MATCH' | 'REVIEW' | 'MISMATCH';
  reasons: string[];
};

export function qualificationTokens(value?: string | null): string[] {
  return (value ?? '').split(/[,;\n]/).map(token => token.normalize('NFKC').trim().toLocaleLowerCase('de-DE')).filter(Boolean);
}

const GS = new Set(['gs', 'grundschule', 'grundschullehrkraft', 'grundschullehrer']);
const MS = new Set(['ms', 'mittelschule', 'mittelschullehrkraft', 'mittelschullehrer']);
const SCHOOL_LABELS = new Set([...GS, ...MS, 'alles']);

export function requestedTeachingSchoolType(request: TeachingRequirements): 'GRUNDSCHULE' | 'MITTELSCHULE' | null {
  if (request.requestedSchoolType === 'GRUNDSCHULE' || request.requestedSchoolType === 'MITTELSCHULE') return request.requestedSchoolType;
  const labels = qualificationTokens(request.qualifications);
  const gs = labels.some(label => GS.has(label));
  const ms = labels.some(label => MS.has(label));
  if (gs !== ms) return gs ? 'GRUNDSCHULE' : 'MITTELSCHULE';
  if (request.gradeLevel) return request.gradeLevel <= 4 ? 'GRUNDSCHULE' : 'MITTELSCHULE';
  if (request.schoolType === 'GRUNDSCHULE' || request.schoolType === 'MITTELSCHULE') return request.schoolType;
  return null;
}

function subjectKey(value: string): string {
  const key = value.normalize('NFKC').trim().toLocaleLowerCase('de-DE');
  return ({ mathe: 'mathematik', sport: 'sport', sportunterricht: 'sport', 'engl.': 'englisch' } as Record<string, string>)[key] ?? key;
}

/** Display form of a normalized subject key: "deutsch" → "Deutsch", "heimat- und sachunterricht" → "Heimat- und Sachunterricht". */
export function subjectLabel(key: string): string {
  return key.replace(/(^|[\s/(-])(\p{L})/gu, (match, prefix: string, letter: string, offset: number) =>
    // Keep short connecting words lowercase except at the very beginning.
    offset > 0 && /^(und|oder|für|mit)\b/u.test(key.slice(offset + prefix.length)) ? match : prefix + letter.toLocaleUpperCase('de-DE'));
}

/** Reserves without a current qualification category (never selected or the old
 * generic "Lehrkraft" value) are provisionally suitable for every deployment
 * until they complete their profile. */
export function lacksQualificationType(type?: string | null): boolean {
  return !type || type === 'TEACHER';
}
export const PROVISIONAL_QUALIFICATION_REASON = 'Qualifikationsstatus fehlt – vorläufig für alle Einsätze passend';

/** Unknown information is reviewable, never represented as a proven qualification. */
export function teachingSuitability(teacher: TeachingProfile, request: TeachingRequirements): MatchSuitability {
  const reasons: string[] = [];
  let level: MatchSuitability['level'] = 'MATCH';
  const review = (reason: string) => { if (level !== 'MISMATCH') level = 'REVIEW'; reasons.push(reason); };
  const mismatch = (reason: string) => { level = 'MISMATCH'; reasons.push(reason); };
  const schoolType = requestedTeachingSchoolType(request);
  const labels = qualificationTokens(teacher.qualifications);
  const subjects = [...new Set([
    ...qualificationTokens(request.requiredSubject),
    ...qualificationTokens(request.qualifications).filter(label => !SCHOOL_LABELS.has(label)),
  ].map(subjectKey))];
  const explicitRequirements = Boolean(request.requestedSchoolType || request.gradeLevel || request.requiredSubject);
  const type = teacher.qualificationType;
  const provisional = lacksQualificationType(type);
  const legacyBroad = provisional || (!explicitRequirements && labels.includes('alles') && !type);
  const subjectLabels = new Set(labels.map(subjectKey));

  if (provisional) {
    reasons.push(PROVISIONAL_QUALIFICATION_REASON);
  } else if (type === 'SUPPORT' || type === 'STUDENT') {
    review('Einsatz einer Unterstützungskraft muss fachlich geprüft werden');
  } else if (type === 'SPECIALIST') {
    if (subjects.length === 0) review('Fachlehrkraft: Für Klassenvertretung ist eine fachliche Prüfung erforderlich');
    else reasons.push('Fachlehrkraft für Fachbedarf');
  } else if (schoolType) {
    const expected = schoolType === 'GRUNDSCHULE' ? 'TEACHER_GS' : 'TEACHER_MS';
    const label = schoolType === 'GRUNDSCHULE' ? 'GS' : 'MS';
    if (type === 'TEACHER_GS' || type === 'TEACHER_MS') {
      if (type === expected) reasons.push(`${label}-Lehrkraft passt`);
      else mismatch(`${label}-Bedarf: Schulart der Lehrkraft weicht ab`);
    } else if (labels.some(value => (schoolType === 'GRUNDSCHULE' ? GS : MS).has(value))) {
      reasons.push(`${label} in Qualifikationen hinterlegt`);
    } else if (legacyBroad) {
      reasons.push('Bisherige breite Qualifikationsangabe');
    } else {
      review(`${label}-Eignung noch nicht eindeutig hinterlegt`);
    }
  } else if (explicitRequirements || request.schoolType === 'GS_MS') {
    review('Benötigte Schulart noch nicht eindeutig angegeben');
  }

  if (request.gradeLevel) {
    reasons.push(`Jahrgangsstufe ${request.gradeLevel}${request.gradeLevel <= 2 ? ' · GS-Anfangsunterricht' : ''}`);
  }
  for (const subject of subjects) {
    if (subject === 'sport' && teacher.canTeachSports === false) {
      mismatch('Sport laut Lehrkraftprofil nicht möglich');
    } else if (subjectLabels.has(subject) || (subject === 'sport' && teacher.canTeachSports === true)) {
      reasons.push(`Fach ${subjectLabel(subject)} passt`);
    } else if (!legacyBroad) {
      review(`Fach ${subjectLabel(subject)}: passende Qualifikation nicht hinterlegt`);
    }
  }
  return { level, reasons };
}

export const suitabilityOrder = (suitability?: MatchSuitability): number =>
  suitability?.level === 'MISMATCH' ? 2 : suitability?.level === 'REVIEW' ? 1 : 0;

export class SuitabilityConfirmationRequired extends Error {
  constructor(readonly suitability: MatchSuitability) {
    super(`Fachliche Ausweichbesetzung bitte ausdrücklich bestätigen: ${suitability.reasons.join(' · ')}.`);
    this.name = 'SuitabilityConfirmationRequired';
  }
}

export function requireTeachingSuitability(teacher: TeachingProfile, request: TeachingRequirements, allowOverride = false): MatchSuitability {
  const suitability = teachingSuitability(teacher, request);
  if (suitability.level !== 'MATCH' && !allowOverride) throw new SuitabilityConfirmationRequired(suitability);
  return suitability;
}
