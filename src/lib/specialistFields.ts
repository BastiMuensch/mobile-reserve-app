import { z } from 'zod';

/** Offered as a starting point when an office switches the Fachlehrkraft module on. */
export const DEFAULT_SPECIALIST_FIELDS = ['E/G', 'M/T'] as const;
export const SPECIALIST_SCHOOL_TYPE = 'FACHLEHRKRAFT';

/** "e/g " and "E/G" are the same Fachrichtung; labels are short codes chosen by the office. */
export function normalizeSpecialistField(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('de-DE');
}

export const specialistFieldSchema = z.string().transform(normalizeSpecialistField)
  .pipe(z.string().min(1).max(40, 'Eine Fachrichtung darf höchstens 40 Zeichen lang sein.'));

export const specialistFieldListSchema = z.array(specialistFieldSchema).max(20, 'Bitte höchstens 20 Fachrichtungen anlegen.')
  .transform(values => [...new Set(values)]);

/** Office settings as the rest of the app sees them: the list only counts while the module is on. */
export function activeSpecialistFields(profile?: { specialistRequestsEnabled?: boolean | null; specialistFields?: string[] | null } | null): string[] {
  return profile?.specialistRequestsEnabled === true ? profile.specialistFields ?? [] : [];
}

/** Keep only fields the office still offers; historic values stay stored but are not re-selectable. */
export function selectableSpecialistFields(selected: string[] | null | undefined, offered: string[]): string[] {
  const allowed = new Set(offered);
  return [...new Set((selected ?? []).map(normalizeSpecialistField))].filter(field => allowed.has(field));
}

export class SpecialistFieldRequiredError extends Error {
  constructor() {
    super('Bitte wählen Sie mindestens eine Fachrichtung aus.');
    this.name = 'SpecialistFieldRequiredError';
  }
}

/**
 * What to store as a reserve's Fachrichtungen.
 * - Module off: undefined (leave stored values untouched, nothing is asked).
 * - Not a Fachlehrkraft: [] (Fachrichtungen only describe Fachlehrkräfte).
 * - Fachlehrkraft: the offered subset of the request; undefined when the client sent none and none are required.
 */
export function resolveTeacherSpecialistFields({ requested, qualificationType, offered, required = false }: {
  requested?: string[] | null;
  qualificationType?: string | null;
  offered: string[];
  required?: boolean;
}): string[] | undefined {
  if (offered.length === 0 || qualificationType === undefined) return undefined;
  if (qualificationType !== 'SPECIALIST') return [];
  if (requested == null && !required) return undefined;
  const fields = selectableSpecialistFields(requested, offered);
  if (required && fields.length === 0) throw new SpecialistFieldRequiredError();
  return fields;
}

/** Display label of the requested deployment: Grundschule, Mittelschule or Fachlehrkraft (with Fachrichtung). */
export function requestedDeploymentLabel(request: { requestedSchoolType?: string | null; requestedSpecialistField?: string | null }, short = false): string | null {
  if (request.requestedSchoolType === 'GRUNDSCHULE') return short ? 'GS' : 'Grundschule';
  if (request.requestedSchoolType === 'MITTELSCHULE') return short ? 'MS' : 'Mittelschule';
  if (request.requestedSchoolType === SPECIALIST_SCHOOL_TYPE) {
    return request.requestedSpecialistField ? `Fachlehrkraft ${request.requestedSpecialistField}` : short ? 'Fachlehrkraft' : 'Fachlehrkraft (beliebige Fachrichtung)';
  }
  return null;
}
