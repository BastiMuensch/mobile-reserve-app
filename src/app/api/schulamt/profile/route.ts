import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { protectSecret } from '@/lib/secrets';
import { BAYTGV_LEGAL_TEXT } from '@/lib/onboarding';
import { isPrivateSignatureUrl, removePrivateSignature } from '@/lib/mediaStorage';
import { z } from 'zod';
import { sameSmtpIdentity } from '@/lib/smtpIdentity';

const MAX_FIELD_LENGTH = 500;
const MAX_LEGAL_TEXT_LENGTH = 4000;
const URL_PATH_PATTERN = /^\/uploads\/[a-f0-9-]+\.(png|jpg|jpeg)$/i;
const SIGNATURE_PATH_PATTERN = /^\/api\/media\/[a-f0-9-]+\.(png|jpg|jpeg)$/i;

const optionalUploadPath = z.string().regex(URL_PATH_PATTERN, 'Nur hochgeladene PNG- oder JPEG-Dateien aus /uploads/ sind erlaubt.').nullable().optional().or(z.literal(''));
const optionalSignaturePath = z.string().regex(SIGNATURE_PATH_PATTERN, 'Unterschriften müssen als private PNG- oder JPEG-Datei hochgeladen werden.').nullable().optional().or(z.literal(''));
const optionalEmail = z.string().trim().email('Ungültige E-Mail-Adresse.').optional().or(z.literal(''));

const ProfileInputSchema = z.object({
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
}).superRefine((value, ctx) => {
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
});

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
  await prisma.uploadedAsset.deleteMany({ where: { ownerUserId: userId, url: oldUrl, purpose: 'signature' } });
  await removePrivateSignature(oldUrl);
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
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const parsed = ProfileInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Ungültige Profileinstellungen.' }, { status: 400 });
    }
    const input = parsed.data;
    const existing = await prisma.schulamtProfile.findUnique({ where: { userId: userSession.id } });
    const logoUrl = normalizeUploadPath(input.logoUrl);
    const signatureUrl = normalizeUploadPath(input.signatureUrl);

    // A syntactically valid URL is not evidence of ownership. The upload route
    // writes a purpose-bound asset record, which we require before accepting a
    // profile reference. This also rejects guessed orphan media URLs.
    await Promise.all([
      assertOwnedProfileAsset({ userId: userSession.id, url: logoUrl, purpose: 'logo' }),
      assertOwnedProfileAsset({ userId: userSession.id, url: signatureUrl, purpose: 'signature' }),
    ]);

    let smtpData: {
      smtpHost: string | null;
      smtpPort: number | null;
      smtpSecure: boolean;
      smtpUser: string | null;
      smtpPass: string | null;
      smtpFromName: string | null;
      smtpFromAddress: string | null;
    };

    if (input.mailProvider === 'NONE') {
      smtpData = { smtpHost: null, smtpPort: null, smtpSecure: false, smtpUser: null, smtpPass: null, smtpFromName: null, smtpFromAddress: null };
    } else {
      if (input.smtpPass === '********' && !sameSmtpIdentity(existing, input)) {
        return NextResponse.json({ error: 'SMTP-Ziel oder Benutzer wurde geändert. Bitte geben Sie das SMTP-Passwort erneut ein; gespeicherte Zugangsdaten werden nicht an ein anderes Ziel gesendet.' }, { status: 400 });
      }
      const storedPassword = input.smtpPass === '********' ? existing?.smtpPass ?? null : input.smtpPass || null;
      if (!storedPassword) {
        return NextResponse.json({ error: 'Für SMTP ist ein Passwort erforderlich.' }, { status: 400 });
      }
      let encryptedPassword: string;
      try {
        encryptedPassword = input.smtpPass === '********' ? storedPassword : protectSecret(storedPassword);
      } catch (error) {
        console.error('SMTP encryption is not configured:', error);
        return NextResponse.json({ error: 'SMTP_ENCRYPTION_KEY fehlt oder ist ungültig; Zugangsdaten wurden nicht gespeichert.' }, { status: 503 });
      }
      smtpData = {
        smtpHost: input.smtpHost?.trim() || null,
        smtpPort: input.smtpPort ?? 587,
        smtpSecure: input.smtpSecure ?? false,
        smtpUser: input.smtpUser?.trim() || null,
        smtpPass: encryptedPassword,
        smtpFromName: input.smtpFromName?.trim() || null,
        smtpFromAddress: input.smtpFromAddress?.trim() || null,
      };
    }

    const profile = await prisma.schulamtProfile.upsert({
      where: { userId: userSession.id },
      update: {
        headerText: input.headerText,
        returnAddress: input.returnAddress,
        logoUrl,
        contactAddress: input.contactAddress,
        contactPerson: input.contactPerson,
        city: input.city,
        amtsleitungName: input.amtsleitungName,
        amtsleitungTitle: input.amtsleitungTitle,
        signatureUrl,
        documentSubject: input.documentSubject,
        documentIntro: input.documentIntro,
        documentLegalText: BAYTGV_LEGAL_TEXT,
        documentClosing: input.documentClosing,
        latitude: input.latitude,
        longitude: input.longitude,
        mailProvider: input.mailProvider,
        teacherInviteValidityDays: input.teacherInviteValidityDays,
        ...smtpData,
      },
      create: {
        userId: userSession.id,
        headerText: input.headerText,
        returnAddress: input.returnAddress,
        logoUrl,
        contactAddress: input.contactAddress,
        contactPerson: input.contactPerson,
        city: input.city,
        amtsleitungName: input.amtsleitungName,
        amtsleitungTitle: input.amtsleitungTitle,
        signatureUrl,
        documentSubject: input.documentSubject,
        documentIntro: input.documentIntro,
        documentLegalText: BAYTGV_LEGAL_TEXT,
        documentClosing: input.documentClosing,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        mailProvider: input.mailProvider,
        teacherInviteValidityDays: input.teacherInviteValidityDays,
        ...smtpData,
      },
    });

    // Profile updates first commit their new reference. Only then can the old
    // private signature be removed, and only if no profile still refers to it.
    // A cleanup failure is non-fatal: it leaves an inaccessible file rather than
    // breaking a successfully saved school-office profile.
    await removeReplacedSignature(userSession.id, existing?.signatureUrl ?? null, signatureUrl);

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
