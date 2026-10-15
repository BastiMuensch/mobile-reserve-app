import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { protectSecret } from '@/lib/secrets';
import { BAYTGV_LEGAL_TEXT } from '@/lib/onboarding';
import { isPrivateSignatureUrl, removePrivateSignature } from '@/lib/mediaStorage';
import { z } from 'zod';
import { sameSmtpIdentity } from '@/lib/smtpIdentity';
import { PROFILE_SECTION_FIELDS } from '@/lib/profileSections';

const MAX_FIELD_LENGTH = 500;
const MAX_LEGAL_TEXT_LENGTH = 4000;
const URL_PATH_PATTERN = /^\/uploads\/[a-f0-9-]+\.(png|jpg|jpeg)$/i;
const SIGNATURE_PATH_PATTERN = /^\/api\/media\/[a-f0-9-]+\.(png|jpg|jpeg)$/i;

const optionalUploadPath = z.string().regex(URL_PATH_PATTERN, 'Nur hochgeladene PNG- oder JPEG-Dateien aus /uploads/ sind erlaubt.').nullable().optional().or(z.literal(''));
const optionalSignaturePath = z.string().regex(SIGNATURE_PATH_PATTERN, 'Unterschriften müssen als private PNG- oder JPEG-Datei hochgeladen werden.').nullable().optional().or(z.literal(''));
const optionalEmail = z.string().trim().email('Ungültige E-Mail-Adresse.').optional().or(z.literal(''));

const ProfileFieldsSchema = z.object({
  headerText: z.string().trim().min(1).max(MAX_FIELD_LENGTH),
  returnAddress: z.string().trim().min(1).max(MAX_FIELD_LENGTH),
  contactAddress: z.string().trim().min(1).max(1000),
  contactPerson: z.string().trim().min(1).max(1000),
  city: z.string().trim().min(1).max(120),
  amtsleitungName: z.string().trim().min(1).max(200),
  amtsleitungTitle: z.string().trim().min(1).max(200),
  logoUrl: optionalUploadPath,
  signatureUrl: optionalSignaturePath,
  documentSubject: z.string().trim().min(1).max(300),
  documentIntro: z.string().trim().min(1).max(1000),
  // Der BayTGV-Text wird vom Server vorgegeben. Das Feld bleibt nur für ältere
  // Clients akzeptiert und darf weder die Laufzeitkonstante noch die Datenbank ändern.
  documentLegalText: z.string().max(MAX_LEGAL_TEXT_LENGTH).optional(),
  documentClosing: z.string().trim().min(1).max(300),
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
  mailProvider: z.enum(['NONE', 'SMTP']).default('NONE'),
  smtpHost: z.string().trim().max(255).optional().or(z.literal('')),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(320).optional().or(z.literal('')),
  smtpPass: z.string().max(1000).optional().or(z.literal('')),
  smtpFromName: z.string().trim().max(200).optional().or(z.literal('')),
  smtpFromAddress: optionalEmail,
  teacherInviteValidityDays: z.coerce.number().int().min(1).max(90).default(14),
  requestUrgencyNoteEnabled: z.boolean().optional(),
  reserveShortageMode: z.boolean().optional(),
});

function validateProfile(value: Partial<z.infer<typeof ProfileFieldsSchema>>, ctx: z.RefinementCtx) {
  if (value.latitude === undefined && value.longitude !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Breiten- und Längengrad müssen gemeinsam angegeben werden.' });
  }
  if (value.latitude !== undefined && value.longitude === undefined) {
    ctx.addIssue({ code: 'custom', path: ['longitude'], message: 'Breiten- und Längengrad müssen gemeinsam angegeben werden.' });
  }
  if (value.mailProvider === 'SMTP') {
    if (!value.smtpHost) ctx.addIssue({ code: 'custom', path: ['smtpHost'], message: 'SMTP-Host ist erforderlich.' });
    if (!value.smtpUser) ctx.addIssue({ code: 'custom', path: ['smtpUser'], message: 'SMTP-Benutzer ist erforderlich.' });
    if (!value.smtpFromName) ctx.addIssue({ code: 'custom', path: ['smtpFromName'], message: 'Absendername ist erforderlich.' });
    if (!value.smtpFromAddress) ctx.addIssue({ code: 'custom', path: ['smtpFromAddress'], message: 'Absender-E-Mail ist erforderlich.' });
  }
}
const ProfileInputSchema = ProfileFieldsSchema.superRefine(validateProfile);

type EditableProfileSection = 'documents' | 'notifications';
const sectionSchemas = {
  documents: ProfileFieldsSchema.pick(Object.fromEntries(PROFILE_SECTION_FIELDS.documents.map(key => [key, true])) as Record<(typeof PROFILE_SECTION_FIELDS.documents)[number], true>).strict().superRefine(validateProfile),
  notifications: ProfileFieldsSchema.pick(Object.fromEntries(PROFILE_SECTION_FIELDS.notifications.map(key => [key, true])) as Record<(typeof PROFILE_SECTION_FIELDS.notifications)[number], true>).strict().superRefine(validateProfile),
};

function normalizeUploadPath(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function assertOwnedProfileAsset(input: {
  userId: string;
  url: string | null;
  purpose: 'logo' | 'signature';
}): Promise<void> {
  if (!input.url) return;
  const asset = await prisma.uploadedAsset.findFirst({
    where: { ownerUserId: input.userId, url: input.url, purpose: input.purpose },
    select: { id: true },
  });
  if (!asset) {
    throw new Error(`UNOWNED_${input.purpose.toUpperCase()}_ASSET`);
  }
}

async function removeReplacedSignature(userId: string, oldUrl: string | null, newUrl: string | null): Promise<void> {
  if (!oldUrl || oldUrl === newUrl || !isPrivateSignatureUrl(oldUrl)) return;
  const stillReferenced = await prisma.schulamtProfile.count({ where: { signatureUrl: oldUrl } });
  if (stillReferenced > 0) return;
  if (await removePrivateSignature(oldUrl)) {
    await prisma.uploadedAsset.deleteMany({ where: { ownerUserId: userId, url: oldUrl, purpose: 'signature' } });
  } else {
    // Keep the ownership record so scheduled cleanup can retry the file later.
    console.warn('[MEDIA-CLEANUP] Ersetzte Unterschrift konnte noch nicht gelöscht werden.');
  }
}

function mailProviderFor(profile: { mailProvider: string; smtpHost: string | null; smtpUser: string | null; smtpPass: string | null }): 'NONE' | 'SMTP' {
  return profile.mailProvider === 'SMTP' && profile.smtpHost && profile.smtpUser && profile.smtpPass ? 'SMTP' : 'NONE';
}

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    let profile = await prisma.schulamtProfile.findUnique({ where: { userId: userSession.id } });
    if (!profile) profile = await prisma.schulamtProfile.create({ data: { userId: userSession.id } });

    return NextResponse.json({
      ...profile,
      documentLegalText: BAYTGV_LEGAL_TEXT,
      mailProvider: mailProviderFor(profile),
      smtpPass: profile.smtpPass ? '********' : '',
    });
  } catch (error) {
    console.error('Failed to get Schulamt profile:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return saveProfile(request);
}

async function saveProfile(request: Request, section?: EditableProfileSection, sectionValues?: unknown) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const parsed = (section ? sectionSchemas[section] : ProfileInputSchema).safeParse(section ? sectionValues : await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Ungültige Profileinstellungen.' }, { status: 400 });
    }
    const input = parsed.data;
    const documentInput = 'headerText' in input ? input : null;
    const notificationInput = 'mailProvider' in input ? input : null;
    const existing = await prisma.schulamtProfile.findUnique({ where: { userId: userSession.id } });
    const logoUrl = normalizeUploadPath(documentInput?.logoUrl);
    const signatureUrl = normalizeUploadPath(documentInput?.signatureUrl);

    // A syntactically valid URL is not evidence of ownership. The upload route
    // writes a purpose-bound asset record, which we require before accepting a
    // profile reference. This also rejects guessed orphan media URLs.
    if (documentInput) await Promise.all([
      assertOwnedProfileAsset({ userId: userSession.id, url: logoUrl, purpose: 'logo' }),
      assertOwnedProfileAsset({ userId: userSession.id, url: signatureUrl, purpose: 'signature' }),
    ]);

    let smtpData: Partial<{
      smtpHost: string | null;
      smtpPort: number | null;
      smtpSecure: boolean;
      smtpUser: string | null;
      smtpPass: string | null;
      smtpFromName: string | null;
      smtpFromAddress: string | null;
    }> = {};

    if (notificationInput?.mailProvider === 'NONE') {
      smtpData = { smtpHost: null, smtpPort: null, smtpSecure: false, smtpUser: null, smtpPass: null, smtpFromName: null, smtpFromAddress: null };
    } else if (notificationInput) {
      if (notificationInput.smtpPass === '********' && !sameSmtpIdentity(existing, notificationInput)) {
        return NextResponse.json({ error: 'SMTP-Ziel oder Benutzer wurde geändert. Bitte geben Sie das SMTP-Passwort erneut ein; gespeicherte Zugangsdaten werden nicht an ein anderes Ziel gesendet.' }, { status: 400 });
      }
      const storedPassword = notificationInput.smtpPass === '********' ? existing?.smtpPass ?? null : notificationInput.smtpPass || null;
      if (!storedPassword) {
        return NextResponse.json({ error: 'Für SMTP ist ein Passwort erforderlich.' }, { status: 400 });
      }
      let encryptedPassword: string;
      try {
        encryptedPassword = notificationInput.smtpPass === '********' ? storedPassword : protectSecret(storedPassword);
      } catch (error) {
        console.error('SMTP encryption is not configured:', error);
        return NextResponse.json({ error: 'SMTP_ENCRYPTION_KEY fehlt oder ist ungültig; Zugangsdaten wurden nicht gespeichert.' }, { status: 503 });
      }
      smtpData = {
        smtpHost: notificationInput.smtpHost?.trim() || null,
        smtpPort: notificationInput.smtpPort ?? 587,
        smtpSecure: notificationInput.smtpSecure ?? false,
        smtpUser: notificationInput.smtpUser?.trim() || null,
        smtpPass: encryptedPassword,
        smtpFromName: notificationInput.smtpFromName?.trim() || null,
        smtpFromAddress: notificationInput.smtpFromAddress?.trim() || null,
      };
    }

    const documentData = documentInput ? {
      headerText: documentInput.headerText, returnAddress: documentInput.returnAddress, logoUrl,
      contactAddress: documentInput.contactAddress, contactPerson: documentInput.contactPerson,
      city: documentInput.city, amtsleitungName: documentInput.amtsleitungName, amtsleitungTitle: documentInput.amtsleitungTitle,
      signatureUrl, documentSubject: documentInput.documentSubject, documentIntro: documentInput.documentIntro,
      documentLegalText: BAYTGV_LEGAL_TEXT, documentClosing: documentInput.documentClosing,
      latitude: documentInput.latitude, longitude: documentInput.longitude,
    } : {};
    const notificationData = notificationInput ? { mailProvider: notificationInput.mailProvider, teacherInviteValidityDays: notificationInput.teacherInviteValidityDays, ...smtpData } : {};
    const data = section === 'documents' ? documentData : section === 'notifications' ? notificationData : {
      ...documentData, ...notificationData,
      requestUrgencyNoteEnabled: 'requestUrgencyNoteEnabled' in input ? input.requestUrgencyNoteEnabled : undefined,
      reserveShortageMode: 'reserveShortageMode' in input ? input.reserveShortageMode : undefined,
    };
    const profile = await prisma.schulamtProfile.upsert({
      where: { userId: userSession.id }, update: data, create: { userId: userSession.id, ...data },
    });

    // Profile updates first commit their new reference. Only then can the old
    // private signature be removed, and only if no profile still refers to it.
    // A cleanup failure is non-fatal: it leaves an inaccessible file rather than
    // breaking a successfully saved school-office profile.
    if (section !== 'notifications') await removeReplacedSignature(userSession.id, existing?.signatureUrl ?? null, signatureUrl);

    return NextResponse.json({
      success: true,
      profile: { ...profile, documentLegalText: BAYTGV_LEGAL_TEXT, mailProvider: mailProviderFor(profile), smtpPass: profile.smtpPass ? '********' : '' },
    });
  } catch (error) {
    if (error instanceof Error && (error.message === 'UNOWNED_LOGO_ASSET' || error.message === 'UNOWNED_SIGNATURE_ASSET')) {
      return NextResponse.json({ error: 'Die gewählte Datei gehört nicht zu diesem Schulamtskonto oder hat einen unzulässigen Verwendungszweck.' }, { status: 400 });
    }
    console.error('Failed to save Schulamt profile:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Each settings topic updates only its own fields. Legacy POST stays compatible. */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body === 'object' && 'section' in body) {
      const scoped = z.object({ section: z.enum(['documents', 'notifications']), values: z.record(z.string(), z.unknown()) }).strict().safeParse(body);
      if (!scoped.success) return NextResponse.json({ error: 'Ungültiger Einstellungsbereich.' }, { status: 400 });
      return saveProfile(request, scoped.data.section, scoped.data.values);
    }
    const parsed = z.object({ requestUrgencyNoteEnabled: z.boolean(), reserveShortageMode: z.boolean() }).strict().safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Ungültige Einstellungen zur Zuweisung.' }, { status: 400 });
    const profile = await prisma.schulamtProfile.upsert({ where: { userId: user.id }, update: parsed.data, create: { userId: user.id, ...parsed.data } });
    return NextResponse.json({ success: true, profile: { requestUrgencyNoteEnabled: profile.requestUrgencyNoteEnabled, reserveShortageMode: profile.reserveShortageMode } });
  } catch (error) {
    console.error('Failed to save assignment preferences:', error);
    return NextResponse.json({ error: 'Einstellungen konnten nicht gespeichert werden.' }, { status: 500 });
  }
}
