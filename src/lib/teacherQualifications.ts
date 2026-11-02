import { z } from 'zod';

export const QUALIFICATION_TYPES = {
  TEACHER_GS: 'Lehrkraft – GS',
  TEACHER_MS: 'Lehrkraft – MS',
  SPECIALIST: 'Fachlehrkraft',
  SUPPORT: 'Arbeitsvertrag',
} as const;

// Legacy values remain readable and restorable, but require a new selection when editing.
export type QualificationType = keyof typeof QUALIFICATION_TYPES | 'TEACHER' | 'STUDENT';
export type TeacherQualificationDetails = {
  qualificationType?: QualificationType | null;
  canTeachSports?: boolean | null;
};
export type TeacherQualificationForm = Required<TeacherQualificationDetails>;

// The qualification category also drives matching; Sport is used for explicit Sport needs.
export const qualificationTypeSchema = z.enum(['TEACHER_GS', 'TEACHER_MS', 'SPECIALIST', 'SUPPORT'], {
  error: 'Bitte wählen Sie Lehrkraft – GS, Lehrkraft – MS, Fachlehrkraft oder Arbeitsvertrag.',
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

/** Direct request shown to reserves whose qualification details are incomplete. */
export function qualificationCompletionPrompt(details: { qualificationType?: string | null; canTeachSports?: boolean | null }): string | null {
  const missingType = !isCurrentQualificationType(details.qualificationType);
  const missingSports = details.canTeachSports == null;
  if (!missingType && !missingSports) return null;
  const subject = missingType && missingSports
    ? 'Ihren Qualifikationsstatus und die Angabe zum Sportunterricht'
    : missingType ? 'Ihren Qualifikationsstatus' : 'die Angabe zum Sportunterricht';
  return `Bitte ergänzen Sie jetzt ${subject}.`
    + (missingType ? ' Solange der Qualifikationsstatus fehlt, werden Sie vorläufig für alle Einsätze vorgeschlagen – auch für Schularten oder Fächer, die nicht zu Ihnen passen.' : '');
}

/** Stored lists are comma separated without spaces ("Deutsch,Mathematik"); show them readably. */
export function formatQualificationList(value?: string | null): string {
  return (value ?? '').split(/[,;]/).map(item => item.trim()).filter(Boolean).join(', ');
}
