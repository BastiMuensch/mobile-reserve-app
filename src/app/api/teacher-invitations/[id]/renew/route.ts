export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { activeInvitationKey, createInvitationToken, hashInvitationToken } from '@/lib/teacherInvitations';
import { sendEmail } from '@/lib/email';

const RenewInvitationSchema = z.object({
  validityDays: z.coerce.number().int().min(1).max(90).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = RenewInvitationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ungültige Gültigkeitsdauer.' }, { status: 400 });
  }
  const { id } = await context.params;
  const invitation = await prisma.teacherInvitation.findFirst({
    where: { id, schulamtId: userSession.id },
    select: { id: true, recipientEmail: true, completedAt: true },
  });
  if (!invitation) return NextResponse.json({ error: 'Einladung nicht gefunden.' }, { status: 404 });
  if (invitation.completedAt) {
    return NextResponse.json({ error: 'Eine bereits eingelöste Einladung kann nicht erneuert werden.' }, { status: 409 });
  }

  const profile = await prisma.schulamtProfile.findUnique({ where: { userId: userSession.id }, select: { teacherInviteValidityDays: true } });
  const validityDays = parsed.data.validityDays ?? profile?.teacherInviteValidityDays ?? 14;
  const token = createInvitationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const activeKey = activeInvitationKey(userSession.id, invitation.recipientEmail);

  try {
    const renewed = await prisma.$transaction(async tx => {
      // The fresh hash makes the previous link unusable immediately. The active
      // key also protects against a concurrent duplicate invitation for this email.
      await tx.teacherInvitation.updateMany({
        where: { activeKey, id: { not: invitation.id } },
        data: { activeKey: null, revokedAt: now },
      });
      const claimed = await tx.teacherInvitation.updateMany({
        where: { id: invitation.id, schulamtId: userSession.id, completedAt: null },
        data: { activeKey, tokenHash: hashInvitationToken(token), expiresAt, revokedAt: null },
      });
      if (claimed.count !== 1) throw new Error('INVITATION_COMPLETED');
      return tx.teacherInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
        select: { id: true, recipientEmail: true, expiresAt: true, createdAt: true },
      });
    });
    const link = new URL('/register/teacher', request.url);
    link.searchParams.set('token', token);
    const registrationLink = link.toString();
    const mailSent = await sendEmail(
      invitation.recipientEmail,
      'Erneuerte Einladung zur Registrierung als Mobile Reserve',
      `Ihre Einladung wurde erneuert. Der vorherige Link ist ungültig. Der neue Link ist ${validityDays} Tag(e) gültig:\n\n${registrationLink}`,
      userSession.id,
    );
    return NextResponse.json({ invitation: renewed, registrationLink, mailSent });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVITATION_COMPLETED') {
      return NextResponse.json({ error: 'Die Einladung wurde inzwischen eingelöst und kann nicht erneuert werden.' }, { status: 409 });
    }
    console.error('Failed to renew teacher invitation:', error);
    return NextResponse.json({ error: 'Die Einladung konnte nicht erneuert werden.' }, { status: 500 });
  }
}
