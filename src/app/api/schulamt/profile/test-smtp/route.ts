import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail } from '@/lib/email';

export async function POST() {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const profile = await prisma.schulamtProfile.findUnique({ where: { userId: userSession.id } });
    if (!profile?.smtpHost || !profile.smtpUser || !profile.smtpPass || !profile.smtpFromName || !profile.smtpFromAddress) {
      return NextResponse.json({ error: 'Mailversand ist noch nicht vollständig als SMTP konfiguriert.' }, { status: 409 });
    }

    const delivered = await sendEmail(
      profile.smtpFromAddress,
      'MobileReserve.digital: SMTP-Test',
      'Diese Nachricht bestätigt, dass die SMTP-Konfiguration dieser Schulamtsinstanz funktioniert.',
      userSession.id,
    );
    if (!delivered) {
      return NextResponse.json({ error: 'Der SMTP-Test ist fehlgeschlagen. Bitte Zugangsdaten und Servereinstellungen prüfen.' }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: `Test-E-Mail wurde an ${profile.smtpFromAddress} gesendet.` });
  } catch (error) {
    console.error('SMTP test failed:', error);
    return NextResponse.json({ error: 'SMTP-Test konnte nicht durchgeführt werden.' }, { status: 500 });
  }
}
