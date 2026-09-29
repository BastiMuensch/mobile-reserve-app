import { z } from 'zod';

export const QUALIFICATION_TYPES = {
  TEACHER_GS: 'Lehrkraft – GS',
  TEACHER_MS: 'Lehrkraft – MS',
  SPECIALIST: 'Fachlehrkraft',
  SUPPORT: 'Drittkraft',
} as const;

// Legacy values remain readable and restorable, but require a new selection when editing.
export type QualificationType = keyof typeof QUALIFICATION_TYPES | 'TEACHER' | 'STUDENT';
export type TeacherQualificationDetails = {
  qualificationType?: QualificationType | null;
  canTeachSports?: boolean | null;
};
export type TeacherQualificationForm = Required<TeacherQualificationDetails>;

// These fields only inform the assigned school. They never affect matching.
export const qualificationTypeSchema = z.enum(['TEACHER_GS', 'TEACHER_MS', 'SPECIALIST', 'SUPPORT'], {
  error: 'Bitte wählen Sie Lehrkraft – GS, Lehrkraft – MS, Fachlehrkraft oder Drittkraft.',
});
export const storedQualificationTypeSchema = z.union([qualificationTypeSchema, z.enum(['TEACHER', 'STUDENT'])]);
export const teacherQualificationFields = {
  qualificationType: qualificationTypeSchema,
  canTeachSports: z.boolean({ error: 'Bitte geben Sie an, ob Sie Sport unterrichten können (Ja/Nein).' }),
};

export function isCurrentQualificationType(value: unknown): value is keyof typeof QUALIFICATION_TYPES {
  return typeof value === 'string' && Object.hasOwn(QUALIFICATION_TYPES, value);
}

export function qualificationDetailLabels(details: TeacherQualificationDetails): string[] {
  return [
    `Qualifikationsstatus: ${details.qualificationType === 'TEACHER' ? 'Lehrkraft (Schulart noch nicht angegeben)' : details.qualificationType === 'STUDENT' ? 'Student/in (bisherige Angabe; bitte neu wählen)' : details.qualificationType ? QUALIFICATION_TYPES[details.qualificationType] : 'Noch nicht angegeben'}`,
    `Sport unterrichten: ${details.canTeachSports == null ? 'Noch nicht angegeben' : details.canTeachSports ? 'Ja' : 'Nein'}`,
  ];
}
