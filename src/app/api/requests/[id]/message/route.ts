import { enqueueEmailInTransaction, deliverOutboxIds } from '@/lib/emailOutbox';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { mayReadSchoolOfficeMessage, schoolOfficeMessageSchema } from '@/lib/schoolOfficeMessage';

async function load(id: string) {
  return prisma.request.findUnique({ where: { id }, select: {
    id: true, schoolId: true, urgencyNote: true,
    school: { select: { schulamtId: true, schulamt: { select: { email: true, schulamtProfile: { select: { requestUrgencyNoteEnabled: true } } } } } },
  } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (!['SCHOOL', 'SCHULAMT'].includes(user.role)) return NextResponse.json({ error: 'Kein Zugriff auf Schulnachrichten.' }, { status: 403 });
  const row = await load((await params).id);
  if (!row) return NextResponse.json({ error: 'Anforderung nicht gefunden.' }, { status: 404 });
  if (!mayReadSchoolOfficeMessage(user, row)) return NextResponse.json({ error: 'Kein Zugriff auf diese Anforderung.' }, { status: 403 });
  return NextResponse.json({ note: row.urgencyNote, enabled: row.school.schulamt?.schulamtProfile?.requestUrgencyNoteEnabled === true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (user.role !== 'SCHOOL') return NextResponse.json({ error: 'Nur die meldende Schule kann ihre Nachricht bearbeiten.' }, { status: 403 });
  const parsed = schoolOfficeMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Ungültige Nachricht.' }, { status: 400 });
  const row = await load((await params).id);
  if (!row) return NextResponse.json({ error: 'Anforderung nicht gefunden.' }, { status: 404 });
  if (!mayReadSchoolOfficeMessage(user, row)) return NextResponse.json({ error: 'Kein Zugriff auf diese Anforderung.' }, { status: 403 });
  const enabled = row.school.schulamt?.schulamtProfile?.requestUrgencyNoteEnabled === true;
  if (parsed.data.note && !enabled) return NextResponse.json({ error: 'Das Schulamt hat Schulnachrichten derzeit nicht freigeschaltet.' }, { status: 403 });
  const note = parsed.data.note || null;
  try {
    const result = await prisma.$transaction(async tx => {
    const updated = await tx.request.updateMany({
      where: { id: row.id, schoolId: user.schoolId!, urgencyNote: parsed.data.previousNote,
        ...(note ? { school: { schulamt: { schulamtProfile: { requestUrgencyNoteEnabled: true } } } } : {}),
      },
      data: { urgencyNote: note },
    });
    if (updated.count !== 1) return { conflict: true as const };
    const notification = note !== parsed.data.previousNote && row.school.schulamt?.email ? await enqueueEmailInTransaction(tx, { to: row.school.schulamt.email, schulamtId: row.school.schulamtId ?? undefined, subject: 'Schulnachricht geändert', body: `Die Schulnachricht zum Vorgang ${row.id} wurde geändert. Bitte lesen Sie die aktuelle Nachricht im Portal.` }) : null;
    return { conflict: false as const, notification };
    });
    if (result.conflict) return NextResponse.json({ error: 'Die Nachricht oder Freischaltung wurde inzwischen geändert. Bitte erneut öffnen und prüfen.' }, { status: 409 });
    if (result.notification?.outboxId) await deliverOutboxIds([result.notification.outboxId]).catch(() => undefined);
    return NextResponse.json({ note, enabled }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Nachricht und Benachrichtigung konnten nicht sicher gespeichert werden.' }, { status: 503 }); }
}
