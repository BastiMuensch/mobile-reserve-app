export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentSchoolYear } from '@/lib/schoolYear';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { hashInvitationToken } from '@/lib/teacherInvitations';

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
  qualifications: z.string().trim().min(1, 'Qualifikationen sind erforderlich').max(500),
  preferredType: z.enum(['GRUNDSCHULE', 'MITTELSCHULE', 'BOTH']),
  isPartTime: z.boolean(),
  schedule: z.any().optional().nullable(),
  maxWeeklyHours: z.coerce.number().int().min(1).max(60),
  homeLat: z.number().min(-90).max(90).optional(),
  homeLng: z.number().min(-180).max(180).optional(),
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
  return NextResponse.json({ schools, expiresAt: invitation.expiresAt });
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

    let latitude = data.homeLat;
    let longitude = data.homeLng;
    if (latitude === undefined || longitude === undefined) {
      let geo: unknown;
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(data.address)}`, {
          headers: { 'User-Agent': 'MobileReservenApp/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Geocoding ${response.status}`);
        geo = await response.json();
      } catch {
        return NextResponse.json({ error: 'Adresse konnte derzeit nicht überprüft werden. Bitte versuchen Sie es später erneut.' }, { status: 503 });
      }
      if (!Array.isArray(geo) || !geo[0]?.lat || !geo[0]?.lon) {
        return NextResponse.json({ error: 'Adresse konnte nicht gefunden werden.' }, { status: 400 });
      }
      latitude = Number(geo[0].lat);
      longitude = Number(geo[0].lon);
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json({ error: 'Adresse konnte nicht gefunden werden.' }, { status: 400 });
    }

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
          homeLat: latitude!,
          homeLng: longitude!,
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
