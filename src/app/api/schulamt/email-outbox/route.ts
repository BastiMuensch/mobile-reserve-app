import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { getOutboxPreview, retryOutboxEmail } from '@/lib/emailOutbox';

export async function GET(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    if (new URL(request.url).searchParams.get('summary') === '1') {
      const failed = await prisma.emailOutbox.count({ where: { schulamtId: userSession.id, status: 'FAILED' } });
      return NextResponse.json({ failed });
    }
    const emails = await prisma.emailOutbox.findMany({
      where: { schulamtId: userSession.id },
      select: {
        id: true,
        payloadEncrypted: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
        nextAttemptAt: true,
        sentAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(emails.map(({ payloadEncrypted, ...email }) => {
      const preview = getOutboxPreview(payloadEncrypted);
      return {
        ...email,
        // Sent records are deliberately payload-minimized. Pending/failed
        // records are decrypted only for this authenticated Schulamt response.
        to: preview?.to ?? null,
        subject: preview?.subject ?? null,
        retryAvailable: email.status === 'FAILED' && payloadEncrypted !== null,
      };
    }));
  } catch (error) {
    console.error('Failed to fetch email outbox:', error);
    return NextResponse.json({ error: 'Failed to fetch email outbox' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { action, id } = await request.json();
    if (action !== 'retry' || !id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Ungültige Anfrage. action=retry und id erforderlich.' }, { status: 400 });
    }

    const success = await retryOutboxEmail(id, userSession.id);

    if (!success) {
      return NextResponse.json(
        { error: 'E-Mail konnte nicht zur Wiederholung markiert werden (nur fehlgeschlagene Mails können wiederholt werden).' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to retry outbox email:', error);
    return NextResponse.json({ error: 'Failed to retry email' }, { status: 500 });
  }
}
