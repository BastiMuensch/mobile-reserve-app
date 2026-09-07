export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentSchoolYear } from '@/lib/schoolYear';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { hashInvitationToken } from '@/lib/teacherInvitations';
import { POSTAL_CODE_SCHEMA } from '@/lib/geocoding';

const ipLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 5 });
const GENERIC_REGISTRATION_ERROR = 'Registrierung nicht möglich. Bitte verwenden Sie einen gültigen, noch nicht eingelösten Einladungslink.';
const TokenSchema = z.string().min(32).max(200);

const RegisterSchema = z.object({
  token: TokenSchema,
  name: z.string().trim().min(1, 'Name ist erforderlich').max(200),
  email: z.string().trim().email('Ungültige E-Mail-Adresse').max(320),
  password: z.string().min(12, 'Passwort muss mindestens 12 Zeichen lang sein').max(200),
  stammschuleId: z.string().uuid('Ungültige Schul-ID'),
  address: z.string().trim().min(1, 'Adresse ist erforderlich').max(500),
  postalCode: POSTAL_CODE_SCHEMA,
  qualifications: z.string().trim().min(1, 'Qualifikationen sind erforderlich').max(500),
  preferredType: z.enum(['GRUNDSCHULE', 'MITTELSCHULE', 'BOTH']),
  isPartTime: z.boolean(),
  schedule: z.any().optional().nullable(),
  maxWeeklyHours: z.coerce.number().int().min(1).max(60),
  homeLat: z.number().min(-90).max(90, 'Bitte bestätigen Sie Ihre Position auf der Karte.'),
  homeLng: z.number().min(-180).max(180, 'Bitte bestätigen Sie Ihre Position auf der Karte.'),
});

function isUsableInvitation(invitation: { revokedAt: Date | null; completedAt: Date | null; expiresAt: Date }) {
  return !invitation.revokedAt && !invitation.completedAt && invitation.expiresAt > new Date();
}

async function findUsableInvitation(token: string) {
  const invitation = await prisma.teacherInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: { id: true, schulamtId: true, recipientEmail: true, tokenHash: true, expiresAt: true, revokedAt: true, completedAt: true },
  });
  return invitation && isUsableInvitation(invitation) ? invitation : null;
}

/** The token, rather than a public schulamtId, scopes the selectable schools. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token || !TokenSchema.safeParse(token).success) {
    return NextResponse.json({ error: GENERIC_REGISTRATION_ERROR }, { status: 400 });
  }
  const invitation = await findUsableInvitation(token);
  if (!invitation) return NextResponse.json({ error: GENERIC_REGISTRATION_ERROR }, { status: 400 });

  const schools = await prisma.school.findMany({
    where: { schulamtId: invitation.schulamtId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  // The invitation is already verified above, so returning its bound address lets the
  // registration form prevent a frustrating end-of-form mismatch.
  return NextResponse.json({
    schools,
    expiresAt: invitation.expiresAt,
    recipientEmail: invitation.recipientEmail,
  });
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const { success: ipAllowed } = ipLimiter.check(ip);
    if (!ipAllowed) {
      return NextResponse.json({ error: 'Zu viele Registrierungsversuche von dieser Adresse. Bitte versuchen Sie es später erneut.' }, { status: 429 });
    }

    const parsed = RegisterSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Ungültige Eingaben.' }, { status: 400 });
    }
    const data = parsed.data;
    const normalizedEmail = data.email.toLowerCase();
    const invitation = await findUsableInvitation(data.token);
    if (!invitation || invitation.recipientEmail !== normalizedEmail) {
      return NextResponse.json({ error: GENERIC_REGISTRATION_ERROR }, { status: 400 });
    }

    const school = await prisma.school.findFirst({
      where: { id: data.stammschuleId, schulamtId: invitation.schulamtId },
      select: { id: true },
    });
    if (!school) return NextResponse.json({ error: GENERIC_REGISTRATION_ERROR }, { status: 400 });

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const tokenHash = hashInvitationToken(data.token);
    const now = new Date();
    const result = await prisma.$transaction(async tx => {
      // Conditional token consumption closes races between parallel submissions.
      const claimed = await tx.teacherInvitation.updateMany({
        where: { id: invitation.id, tokenHash, revokedAt: null, completedAt: null, expiresAt: { gt: now } },
        data: { completedAt: now, activeKey: null },
      });
      if (claimed.count !== 1) throw new Error('INVITATION_NOT_USABLE');

      const existingUser = await tx.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
      if (existingUser) throw new Error('EMAIL_ALREADY_USED');

      const newUser = await tx.user.create({
        data: { email: normalizedEmail, password: hashedPassword, name: data.name, role: 'TEACHER', isActive: false },
      });
      return tx.teacher.create({
        data: {
          name: data.name,
          email: normalizedEmail,
          stammschuleId: data.stammschuleId,
          userId: newUser.id,
          status: 'PENDING',
          address: data.address,
          postalCode: data.postalCode,
          homeLat: data.homeLat,
          homeLng: data.homeLng,
          qualifications: data.qualifications,
          preferredType: data.preferredType,
          isPartTime: data.isPartTime,
          schedule: data.isPartTime && data.schedule ? JSON.stringify(data.schedule) : null,
          maxWeeklyHours: data.maxWeeklyHours,
          schoolYear: getCurrentSchoolYear(),
        },
        select: { id: true },
      });
    });

    return NextResponse.json({ success: true, teacherId: result.id });
  } catch (error) {
    if (error instanceof Error && (error.message === 'INVITATION_NOT_USABLE' || error.message === 'EMAIL_ALREADY_USED')) {
      return NextResponse.json({ error: GENERIC_REGISTRATION_ERROR }, { status: 400 });
    }
    console.error('Failed to register teacher:', error);
    return NextResponse.json({ error: 'Registrierung fehlgeschlagen. Bitte versuchen Sie es später noch einmal.' }, { status: 500 });
  }
}
