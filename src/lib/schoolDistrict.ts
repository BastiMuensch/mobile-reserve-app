import { z } from 'zod';

export const schoolDistrictSchema = z.string().trim().max(50, 'Der Schulamtsbezirk darf höchstens 50 Zeichen lang sein.')
  .transform(value => value.toLocaleUpperCase('de') || null).nullable();

export function effectiveSchoolDistrictFilter(selected: string, enabled: boolean | undefined): string {
  return enabled === true ? selected : 'ALL';
}

export function matchesSchoolDistrict(value: string | null | undefined, filter: string): boolean {
  return filter === 'ALL' || (filter === 'UNASSIGNED' ? !value : value === (filter.startsWith('district:') ? filter.slice(9) : filter));
}

export function schoolDistrictOptions(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'de'));
}
