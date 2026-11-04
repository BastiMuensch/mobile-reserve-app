import { z } from 'zod';

const districtCodeSchema = z.string().transform(value => value.trim().toLocaleUpperCase('de'))
  .pipe(z.string().max(50, 'Der Schulamtsbezirk darf höchstens 50 Zeichen lang sein.'));
export const schoolDistrictSchema = districtCodeSchema.transform(value => value || null).nullable();

export function effectiveSchoolDistrictFilter(selected: string, enabled: boolean | undefined): string {
  return enabled === true ? selected : 'ALL';
}

export function matchesSchoolDistrict(value: string | null | undefined, filter: string): boolean {
  return filter === 'ALL' || (filter === 'UNASSIGNED' ? !value : value === (filter.startsWith('district:') ? filter.slice(9) : filter));
}

export function schoolDistrictOptions(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'de'));
}

/** Office-defined districts, stored like individual entries (trimmed, upper case). */
export const schoolDistrictListSchema = z.array(districtCodeSchema.pipe(z.string().min(1)))
  .max(50, 'Bitte höchstens 50 Bezirke anlegen.')
  .transform(values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'de')));

/**
 * Once the office has defined districts, only those can be chosen. A value that was
 * stored earlier may be kept unchanged so existing records stay editable.
 */
export function validateSchoolDistrict(value: string | null | undefined, allowed: string[] | null | undefined, existing?: string | null): string | null {
  const normalized = value ? value.trim().toLocaleUpperCase('de') || null : null;
  if (!normalized || !allowed?.length) return normalized;
  if (allowed.includes(normalized) || normalized === (existing ?? null)) return normalized;
  throw new SchoolDistrictNotAllowedError();
}

export class SchoolDistrictNotAllowedError extends Error {
  constructor() { super('Bitte einen der vom Schulamt festgelegten Schulamtsbezirke auswählen.'); this.name = 'SchoolDistrictNotAllowedError'; }
}

export type DistrictUsage = { value: string; schools: number; teachers: number };

/** Count each stored spelling across schools and reserves, most used first. */
export function districtUsage(schools: { schoolDistrict: string | null }[], teachers: { schoolDistrict: string | null }[]): DistrictUsage[] {
  const usage = new Map<string, DistrictUsage>();
  const add = (value: string | null, key: 'schools' | 'teachers') => {
    if (!value) return;
    const entry = usage.get(value) ?? { value, schools: 0, teachers: 0 };
    entry[key] += 1;
    usage.set(value, entry);
  };
  schools.forEach(school => add(school.schoolDistrict, 'schools'));
  teachers.forEach(teacher => add(teacher.schoolDistrict, 'teachers'));
  return [...usage.values()].sort((a, b) => (b.schools + b.teachers) - (a.schools + a.teachers) || a.value.localeCompare(b.value, 'de'));
}
