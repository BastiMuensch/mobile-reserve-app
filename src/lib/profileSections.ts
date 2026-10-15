import type { TemplateSettingsForm } from '@/types/models';

export const PROFILE_SECTION_FIELDS = {
  assignment: ['requestUrgencyNoteEnabled', 'reserveShortageMode'],
  documents: ['headerText', 'returnAddress', 'logoUrl', 'contactAddress', 'contactPerson', 'city', 'amtsleitungName', 'amtsleitungTitle', 'signatureUrl', 'documentSubject', 'documentIntro', 'documentLegalText', 'documentClosing', 'latitude', 'longitude'],
  notifications: ['mailProvider', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFromName', 'smtpFromAddress', 'teacherInviteValidityDays'],
} as const satisfies Record<string, readonly (keyof TemplateSettingsForm)[]>;

export type ProfileSection = keyof typeof PROFILE_SECTION_FIELDS;

export function profileSectionValues(settings: TemplateSettingsForm, section: ProfileSection): Partial<TemplateSettingsForm> {
  return Object.fromEntries(PROFILE_SECTION_FIELDS[section].map(key => [key, settings[key]]));
}
