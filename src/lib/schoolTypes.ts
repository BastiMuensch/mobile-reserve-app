export const SCHOOL_TYPES = ['GRUNDSCHULE', 'MITTELSCHULE', 'GS_MS'] as const;
export type SchoolType = typeof SCHOOL_TYPES[number];

export const SCHOOL_TYPE_LABELS: Record<SchoolType, string> = {
  GRUNDSCHULE: 'Grundschule',
  MITTELSCHULE: 'Mittelschule',
  GS_MS: 'Grund- und Mittelschule',
};

export function schoolTypeLabel(type: string): string {
  return SCHOOL_TYPES.includes(type as SchoolType) ? SCHOOL_TYPE_LABELS[type as SchoolType] : type;
}
