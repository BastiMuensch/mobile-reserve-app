import { z } from 'zod';

export const QUALIFICATION_TYPES = {
  TEACHER_GS: 'Lehrkraft – GS',
  TEACHER_MS: 'Lehrkraft – MS',
  SUPPORT: 'Drittkraft',
  STUDENT: 'Student/in',
} as const;

// TEACHER is a legacy value whose school type has not been specified yet.
export type QualificationType = keyof typeof QUALIFICATION_TYPES | 'TEACHER';
export type TeacherQualificationDetails = {
  qualificationType?: QualificationType | null;
  canTeachSports?: boolean | null;
};
export type TeacherQualificationForm = Required<TeacherQualificationDetails>;

// These fields only inform the assigned school. They never affect matching.
export const qualificationTypeSchema = z.enum(['TEACHER_GS', 'TEACHER_MS', 'SUPPORT', 'STUDENT'], {
  error: 'Bitte wählen Sie Lehrkraft – GS, Lehrkraft – MS, Drittkraft oder Student/in.',
});
export const storedQualificationTypeSchema = z.union([qualificationTypeSchema, z.literal('TEACHER')]);
export const teacherQualificationFields = {
  qualificationType: qualificationTypeSchema,
  canTeachSports: z.boolean({ error: 'Bitte geben Sie an, ob Sie Sport unterrichten können (Ja/Nein).' }),
};

export function qualificationDetailLabels(details: TeacherQualificationDetails): string[] {
  return [
    `Qualifikationsstatus: ${details.qualificationType === 'TEACHER' ? 'Lehrkraft (Schulart noch nicht angegeben)' : details.qualificationType ? QUALIFICATION_TYPES[details.qualificationType] : 'Noch nicht angegeben'}`,
    `Sport unterrichten: ${details.canTeachSports == null ? 'Noch nicht angegeben' : details.canTeachSports ? 'Ja' : 'Nein'}`,
  ];
}
