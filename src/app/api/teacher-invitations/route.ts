export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { activeInvitationKey, createInvitationToken, hashInvitationToken, toInvitationLink } from '@/lib/teacherInvitations';
import { sendEmailWithStatus } from '@/lib/email';

const CreateInvitationSchema = z.object({
  recipientEmail: z.string().trim().email('Bitte geben Sie eine gültige E-Mail-Adresse ein.').max(320),
  validityDays: z.coerce.number().int().min(1, 'Die Gültigkeit muss mindestens einen Tag betragen.').max(90, 'Einladungen dürfen höchstens 90 Tage gültig sein.').optional(),
});

function invitationStatus(invitation: { expiresAt: Date; revokedAt: Date | null; completedAt: Date | null }) {
  if (invitation.completedAt) return 'COMPLETED';
  if (invitation.revokedAt) return 'REVOKED';
  if (invitation.expiresAt <= new Date()) return 'EXPIRED';
  return 'ACTIVE';
}

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [invitations, profile] = await Promise.all([
    prisma.teacherInvitation.findMany({
      where: { schulamtId: userSession.id },
      select: { id: true, recipientEmail: true, expiresAt: true, createdAt: true, revokedAt: true, completedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.schulamtProfile.findUnique({ where: { userId: userSession.id }, select: { teacherInviteValidityDays: true } }),
  ]);

  return NextResponse.json({
    defaultValidityDays: profile?.teacherInviteValidityDays ?? 14,
    invitations: invitations.map(invitation => ({ ...invitation, status: invitationStatus(invitation) })),
  });
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = CreateInvitationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Ungültige Einladung.' }, { status: 400 });
  }

  const recipientEmail = parsed.data.recipientEmail.toLowerCase();
  const profile = await prisma.schulamtProfile.findUnique({ where: { userId: userSession.id }, select: { teacherInviteValidityDays: true } });
  const validityDays = parsed.data.validityDays ?? profile?.teacherInviteValidityDays ?? 14;
  const token = createInvitationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  try {
    const invitation = await prisma.$transaction(async tx => {
      // A recipient has exactly one usable link per Schulamt. Replacing it
      // invalidates any earlier URL before issuing the new bearer token.
      const activeKey = activeInvitationKey(userSession.id, recipientEmail);
      await tx.teacherInvitation.updateMany({
        where: { activeKey },
        data: { activeKey: null, revokedAt: now },
      });
      return tx.teacherInvitation.create({
        data: {
          schulamtId: userSession.id,
          recipientEmail,
          activeKey,
          tokenHash: hashInvitationToken(token),
          expiresAt,
        },
        select: { id: true, recipientEmail: true, expiresAt: true, createdAt: true },
      });
    });

    const registrationLink = toInvitationLink(token, request);
    if (!registrationLink) {
      return NextResponse.json({
        error: 'NEXT_PUBLIC_APP_URL ist in der Produktionsumgebung nicht konfiguriert. Einladungslink konnte nicht generiert werden.',
      }, { status: 500 });
    }
    const mailStatus = await sendEmailWithStatus(
      recipientEmail,
      'Einladung zur Registrierung als Mobile Reserve',
      `Sie wurden zur Registrierung als Mobile Reserve eingeladen. Der Link ist ${validityDays} Tag(e) gültig:\n\n${registrationLink}\n\nFalls Sie diese Einladung nicht erwartet haben, ignorieren Sie diese Nachricht.`,
      userSession.id,
    );
    return NextResponse.json({
      invitation,
      registrationLink,
      mailSent: mailStatus.mailDelivered,
      mailQueued: mailStatus.mailQueued,
      mailDelivered: mailStatus.mailDelivered,
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to create teacher invitation:', error);
    return NextResponse.json({ error: 'Die Einladung konnte nicht erstellt werden. Bitte versuchen Sie es erneut.' }, { status: 500 });
  }
}
