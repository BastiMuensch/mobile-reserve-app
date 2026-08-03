import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { recalculateRequestStatus } from '@/lib/leaveService';
import { z } from 'zod';

/**
 * "Keine Reserve verfügbar": Das Schulamt teilt der Schule ausdrücklich mit, dass eine
 * Anforderung nicht besetzt werden kann. Rücknehmbar (siehe DELETE unten), damit eine
 * später doch verfügbare Lehrkraft die Anforderung nicht dauerhaft blockiert.
 */
const UnfilledSchema = z.object({
  reason: z.string().max(500, 'Die Begründung darf höchstens 500 Zeichen lang sein.').optional(),
});

/** "03.08.2026" bzw. "03.08.2026 – 07.08.2026" für die E-Mail an die Schule. */
function formatRequestRange(date: Date, endDate: Date | null): string {
  const start = new Date(date).toLocaleDateString('de-DE');
  if (!endDate) return start;
  return `${start} – ${new Date(endDate).toLocaleDateString('de-DE')}`;
}

/**
 * Lädt die Anforderung samt Schule/Nutzer (für die Benachrichtigung) und prüft, ob sie
 * zum Schulamt des Aufrufers gehört. Die Rollenprüfung selbst erfolgt bereits im
 * jeweiligen Handler, damit "nicht angemeldet" und "falsche Rolle" einheitlich als 401
 * beantwortet werden.
 */
async function loadOwnedRequest(id: string, userSession: { id: string }) {
  const req = await prisma.request.findUnique({
    where: { id },
    include: { school: { include: { user: true } } },
  });

  if (!req) {
    return { error: NextResponse.json({ error: 'Anforderung nicht gefunden.' }, { status: 404 }) };
  }
  if (req.school.schulamtId !== userSession.id) {
    return { error: NextResponse.json({ error: 'Forbidden: Anforderung gehört nicht zu Ihrem Schulamt.' }, { status: 403 }) };
  }
  return { req };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    const loaded = await loadOwnedRequest(id, userSession);
    if ('error' in loaded) return loaded.error;
    const req = loaded.req;

    // Leerer Body ist erlaubt (Begründung ist optional) – ein Client, der gar nichts
    // mitschickt, soll nicht an einem JSON-Parse-Fehler scheitern.
    let payload: unknown = {};
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }
    const parsed = UnfilledSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const reason = parsed.data.reason?.trim() || null;

    // Nur eine offene oder teilweise besetzte Anforderung kann als unbesetzbar markiert
    // werden. Eine bereits volle Anforderung hat eine Lehrkraft zugewiesen – das
    // rückgängig zu machen wäre eine Zuweisungs-Stornierung, keine Absage mangels
    // Reserve, und läuft über einen anderen Weg.
    if (req.status !== 'PENDING' && req.status !== 'PARTIALLY_FILLED') {
      return NextResponse.json({
        error: `Die Anforderung kann im Status "${req.status}" nicht als unbesetzbar markiert werden.`,
      }, { status: 409 });
    }

    // Vorhandene Zuweisungen (möglich bei PARTIALLY_FILLED) bleiben unangetastet – die
    // bereits besetzten Stunden bleiben besetzt, es fehlt lediglich der Rest.
    const updated = await prisma.request.update({
      where: { id },
      data: { status: 'UNFILLED', unfilledReason: reason, unfilledAt: new Date() },
    });

    // Ein fehlgeschlagener Mailversand darf die bereits gespeicherte Entscheidung nicht
    // rückgängig machen – deshalb nur loggen, nicht werfen.
    try {
      if (req.school.user?.email) {
        const range = formatRequestRange(req.date, req.endDate);
        await sendEmail(
          req.school.user.email,
          `Keine Reserve verfügbar: ${range}`,
          `Für Ihre Anforderung am ${range} konnte leider keine Mobile Reserve gestellt werden.\n\n` +
          (reason ? `Begründung: ${reason}\n\n` : '') +
          `Das Schulamt kann diese Entscheidung jederzeit zurücknehmen, falls sich die Lage ` +
          `ändert – die Anforderung ist dann wieder offen und wird erneut für eine Besetzung ` +
          `berücksichtigt.`,
          userSession.id
        );
      }
    } catch (error) {
      console.error('Benachrichtigung zur Absage mangels Reserve fehlgeschlagen:', error);
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Markieren als unbesetzbar fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Die Anforderung konnte nicht als unbesetzbar markiert werden.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    const loaded = await loadOwnedRequest(id, userSession);
    if ('error' in loaded) return loaded.error;
    const req = loaded.req;

    if (req.status !== 'UNFILLED') {
      return NextResponse.json({
        error: `Die Anforderung ist nicht als unbesetzbar markiert (Status: "${req.status}").`,
      }, { status: 409 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Der Status wird hier bewusst schon auf PENDING gesetzt (statt den Feldern die
      // Neuberechnung allein zu überlassen): recalculateRequestStatus lässt UNFILLED
      // absichtlich unangetastet (siehe leaveService.ts), damit z.B. eine gemeldete
      // Abwesenheit eine Absage nicht unbemerkt aufhebt. Diese Route hier IST die
      // ausdrückliche Rücknahme, also verlassen wir den UNFILLED-Status zuerst selbst.
      await tx.request.update({
        where: { id },
        data: { unfilledReason: null, unfilledAt: null, status: 'PENDING' },
      });

      // Berechnet den tatsächlichen Status aus den vorhandenen Zuweisungen: leer bleibt
      // PENDING, teilweise besetzt wird PARTIALLY_FILLED, voll besetzt wird FILLED.
      await recalculateRequestStatus(tx, id);

      return tx.request.findUniqueOrThrow({ where: { id } });
    });

    try {
      if (req.school.user?.email) {
        const range = formatRequestRange(req.date, req.endDate);
        await sendEmail(
          req.school.user.email,
          `Anforderung wieder offen: ${range}`,
          `Die Absage zu Ihrer Anforderung am ${range} wurde vom Schulamt zurückgenommen. ` +
          `Die Anforderung wird wieder für eine Besetzung mit einer Mobilen Reserve berücksichtigt.`,
          userSession.id
        );
      }
    } catch (error) {
      console.error('Benachrichtigung zur Rücknahme der Absage fehlgeschlagen:', error);
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Rücknahme der Absage mangels Reserve fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Die Absage konnte nicht zurückgenommen werden.' }, { status: 500 });
  }
}
