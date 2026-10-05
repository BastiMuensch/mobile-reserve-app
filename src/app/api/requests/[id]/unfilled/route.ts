import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { recalculateRequestStatus } from '@/lib/leaveService';
import { getOpenRequestDays } from '@/lib/requestDays';
import { activeUnfilledDays, parseUnfilledDays } from '@/lib/unfilledDays';
import { isValidDateKey } from '@/lib/dateKey';
import { z } from 'zod';

const DecisionSchema = z.object({
  date: z.string().refine(isValidDateKey, 'Bitte wählen Sie einen gültigen Einsatztag.').optional(),
  reason: z.string().max(500, 'Die Begründung darf höchstens 500 Zeichen lang sein.').optional(),
});

function formatDay(date: Date | string): string {
  return new Date(date).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
}

async function readPayload(request: Request) {
  const body = await request.text();
  if (!body.trim()) return DecisionSchema.safeParse({});
  try {
    return DecisionSchema.safeParse(JSON.parse(body));
  } catch {
    return DecisionSchema.safeParse({ date: '' });
  }
}

async function loadOwnedRequest(tx: Prisma.TransactionClient, id: string, schulamtId: string) {
  const req = await tx.request.findUnique({
    where: { id },
    include: { location: true, school: { include: { user: true } }, assignments: true },
  });
  if (!req) return { error: NextResponse.json({ error: 'Anforderung nicht gefunden.' }, { status: 404 }) };
  if (req.school.schulamtId !== schulamtId) {
    return { error: NextResponse.json({ error: 'Forbidden: Anforderung gehört nicht zu Ihrem Schulamt.' }, { status: 403 }) };
  }
  return { req };
}

async function decisionResponse(committed: {
  updated: object;
  notification: { warning?: string; outboxId?: string } | null;
}) {
  const warnings: string[] = [];
  if (committed.notification?.warning) warnings.push(committed.notification.warning);
  if (committed.notification?.outboxId) {
    const delivery = await deliverOutboxIds([committed.notification.outboxId]);
    if (delivery.delivered !== 1) warnings.push('Die Entscheidung wurde gespeichert, aber die E-Mail an die Schule wurde nicht sofort zugestellt.');
  }
  return NextResponse.json({
    ...committed.updated,
    notificationWarning: warnings.length > 0,
    notificationWarnings: warnings.length > 0 ? warnings : undefined,
  });
}

function errorResponse(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    return NextResponse.json({ error: 'Der Bedarf wurde gleichzeitig geändert. Bitte aktualisieren Sie die Daten und versuchen Sie es erneut.' }, { status: 409 });
  }
  console.error('Tageweise Absage fehlgeschlagen:', error);
  return NextResponse.json({ error: 'Die Entscheidung konnte nicht gespeichert werden.' }, { status: 500 });
}

/** Marks only the selected day. Future days of the same request remain available. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const parsed = await readPayload(request);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const committed = await prisma.$transaction(async tx => {
      const loaded = await loadOwnedRequest(tx, id, user.id);
      if (loaded.error) return { error: loaded.error };
      const req = loaded.req;
      if (req.status !== 'PENDING' && req.status !== 'PARTIALLY_FILLED') {
        return { error: NextResponse.json({ error: 'Dieser Bedarf ist nicht offen. Bitte aktualisieren Sie die Daten.' }, { status: 409 }) };
      }
      const openDays = getOpenRequestDays(req, req.assignments);
      // Older clients without a date can still mark a single-day request. A longer
      // request requires a deliberate selection, never a silent whole-range refusal.
      const date = parsed.data.date ?? (openDays.length === 1 ? openDays[0].date : undefined);
      if (!date) return { error: NextResponse.json({ error: 'Bitte wählen Sie den Einsatztag für die Absage.' }, { status: 400 }) };
      if (!openDays.some(day => day.date === date)) {
        return { error: NextResponse.json({ error: 'Für den gewählten Tag besteht kein offener Bedarf mehr.' }, { status: 409 }) };
      }
      const reason = parsed.data.reason?.trim() || null;
      const history = parseUnfilledDays(req.unfilledDays);
      history.push({ date, reason, decidedAt: new Date().toISOString() });
      await tx.request.update({ where: { id }, data: { unfilledDays: JSON.stringify(history) } });
      await recalculateRequestStatus(tx, id);
      const updated = await tx.request.findUniqueOrThrow({ where: { id } });
      const notification = req.school.user?.email
        ? await enqueueEmailInTransaction(tx, {
          to: req.school.user.email,
          subject: `Keine Reserve verfügbar: ${formatDay(date)}`,
          body: `Für den noch offenen Bedarf Ihrer Anforderung am ${formatDay(date)} konnte leider keine Mobile Reserve gestellt werden.\n\n`
            + (reason ? `Begründung: ${reason}\n\n` : '')
            + 'Die Absage gilt ausschließlich für diesen Tag. Weitere Einsatztage der Anforderung bleiben offen, soweit sie noch nicht besetzt sind. Bereits zugewiesene Einsätze bleiben bestehen.\n\n'
            + 'Das Schulamt kann die Absage für diesen Tag zurücknehmen, falls eine Reserve verfügbar wird.',
          schulamtId: user.id,
        }) : null;
      return { updated, notification };
    }, { isolationLevel: 'Serializable' });
    if (committed.error) return committed.error;
    return await decisionResponse(committed);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Explicit day reversal; supports legacy whole-request decisions without a date. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const parsed = await readPayload(request);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const committed = await prisma.$transaction(async tx => {
      const loaded = await loadOwnedRequest(tx, id, user.id);
      if (loaded.error) return { error: loaded.error };
      const req = loaded.req;
      const date = parsed.data.date;
      const legacy = req.status === 'UNFILLED' && !req.unfilledDays;
      if (legacy && date) return { error: NextResponse.json({ error: 'Diese ältere Absage gilt für die gesamte Anforderung und muss vollständig zurückgenommen werden.' }, { status: 400 }) };
      if (!legacy && (!date || !activeUnfilledDays(req.unfilledDays).some(day => day.date === date))) {
        return { error: NextResponse.json({ error: 'Für den gewählten Tag liegt keine aktive Absage vor.' }, { status: 409 }) };
      }
      if (req.status === 'CANCELLED') return { error: NextResponse.json({ error: 'Diese Anforderung wurde storniert.' }, { status: 409 }) };
      const history = parseUnfilledDays(req.unfilledDays).map(day => day.date === date && !day.revertedAt
        ? { ...day, revertedAt: new Date().toISOString() } : day);
      await tx.request.update({ where: { id }, data: {
        ...(legacy ? { unfilledReason: null, unfilledAt: null } : { unfilledDays: JSON.stringify(history) }),
        status: 'PENDING',
      } });
      await recalculateRequestStatus(tx, id);
      const updated = await tx.request.findUniqueOrThrow({ where: { id } });
      const range = date ? formatDay(date) : `${formatDay(req.date)}${req.endDate ? ` – ${formatDay(req.endDate)}` : req.isOpenEnded ? ' bis auf Weiteres' : ''}`;
      const notification = req.school.user?.email
        ? await enqueueEmailInTransaction(tx, {
          to: req.school.user.email,
          subject: `Anforderung wieder offen: ${range}`,
          body: `Die Absage zu Ihrer Anforderung am ${range} wurde vom Schulamt zurückgenommen. Der Bedarf wird wieder für eine Besetzung mit einer Mobilen Reserve berücksichtigt.`,
          schulamtId: user.id,
        }) : null;
      return { updated, notification };
    }, { isolationLevel: 'Serializable' });
    if (committed.error) return committed.error;
    return await decisionResponse(committed);
  } catch (error) {
    return errorResponse(error);
  }
}
