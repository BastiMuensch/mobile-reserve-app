import { Prisma } from '@prisma/client';
import { toLocalDayStart } from '@/lib/matching';

/**
 * Datenbankseitige Logik für längere Abwesenheiten. Reine Hilfsfunktionen ohne
 * Datenbankzugriff stehen in src/lib/leave.ts, damit sie auch im Browser nutzbar sind.
 */

/** Setzt die Grenzen eines Zeitraums auf lokale Tagesgrenzen (Ende einschließlich). */
export function normalizeLeaveRange(startDate: string | Date, endDate?: string | Date | null) {
  const start = toLocalDayStart(startDate);
  if (!endDate) return { start, end: null as Date | null };
  const end = toLocalDayStart(endDate);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Berechnet den Status einer Anforderung neu, nachdem Zuweisungen storniert wurden:
 * ohne verbleibende Stunden ist sie wieder offen, sonst teilweise bzw. voll besetzt.
 */
export async function recalculateRequestStatus(tx: Prisma.TransactionClient, requestId: string) {
  const request = await tx.request.findUnique({ where: { id: requestId } });
  if (!request) return;

  // Eine vom Schulamt bewusst als "keine Reserve verfügbar" markierte Anforderung
  // (Status UNFILLED) wird hier NICHT automatisch wieder geöffnet. Ohne diese Sperre
  // würde z.B. eine von der Lehrkraft gemeldete längere Abwesenheit – die ebenfalls
  // über cancelAssignmentsInLeaveRange in diese Funktion läuft – die Absage unbemerkt
  // rückgängig machen, obwohl die Schule nie darüber informiert wurde. Die Rücknahme
  // erfolgt ausschließlich ausdrücklich über DELETE /api/requests/[id]/unfilled.
  if (request.status === 'UNFILLED') return;

  const remaining = await tx.assignment.findMany({
    where: { requestId, status: { not: 'REJECTED' } },
    select: { hours: true },
  });
  const filledHours = remaining.reduce((sum, a) => sum + a.hours, 0);

  // Ein Bedarf "bis auf Weiteres" wird nie FILLED. weeklyHours ist bei einem Bedarf mit
  // Stundenplan die WOCHEN-Summe - ein laufender offener Bedarf spränge also auf FILLED,
  // sobald eine einzige Woche besetzt ist, fiele damit aus den offenen Bedarfen und aus
  // der Idealbesetzung heraus und würde nie wieder besetzt. "Vollständig besetzt" ist bei
  // unbekanntem Ende ohnehin keine sinnvolle Aussage: Er endet, wenn die Schule die
  // Rückkehr meldet (PATCH /api/requests/[id]/end).
  if (request.isOpenEnded && !request.endDate) {
    await tx.request.update({
      where: { id: requestId },
      data: { status: filledHours === 0 ? 'PENDING' : 'PARTIALLY_FILLED' },
    });
    return;
  }

  const status = filledHours === 0
    ? 'PENDING'
    : filledHours >= request.weeklyHours ? 'FILLED' : 'PARTIALLY_FILLED';

  await tx.request.update({ where: { id: requestId }, data: { status } });
}

/**
 * Storniert alle noch gültigen Einsätze der Lehrkraft im Abwesenheitszeitraum und gibt
 * die betroffenen Anforderungen wieder frei. Ohne Enddatum gilt der Zeitraum als offen,
 * es werden also alle Einsätze ab Beginn storniert.
 *
 * Rückgabe: die stornierten Zuweisungen samt Anforderung – der Aufrufer benachrichtigt
 * damit die betroffenen Schulen.
 */
export async function cancelAssignmentsInLeaveRange(
  tx: Prisma.TransactionClient,
  teacherId: string,
  start: Date,
  end: Date | null
) {
  const affected = await tx.assignment.findMany({
    where: {
      teacherId,
      status: { not: 'REJECTED' },
      date: end ? { gte: start, lte: end } : { gte: start },
    },
    include: { request: { include: { school: { include: { user: true } } } } },
  });

  if (affected.length === 0) return [];

  await tx.assignment.updateMany({
    where: { id: { in: affected.map(a => a.id) } },
    data: { status: 'REJECTED' },
  });

  for (const requestId of new Set(affected.map(a => a.requestId))) {
    await recalculateRequestStatus(tx, requestId);
  }

  return affected;
}

/**
 * Storniert alle Einsätze einer Anforderung NACH einem Stichtag – gebraucht, wenn eine
 * Schule die Rückkehr meldet und der Bedarf damit früher endet als geplant.
 *
 * Ohne diese Stornierung stünde die Lehrkraft weiterhin für Tage im Kalender, an denen
 * niemand mehr vertreten werden muss, und würde am Einsatzort erscheinen.
 *
 * Rückgabe: die stornierten Zuweisungen samt Lehrkraft – der Aufrufer benachrichtigt
 * damit die Betroffenen.
 */
export async function cancelAssignmentsAfter(
  tx: Prisma.TransactionClient,
  requestId: string,
  lastDay: Date
) {
  const cutoff = toLocalDayStart(lastDay);
  cutoff.setHours(23, 59, 59, 999);

  const affected = await tx.assignment.findMany({
    where: { requestId, status: { not: 'REJECTED' }, date: { gt: cutoff } },
    include: { teacher: { include: { user: true } } },
  });

  if (affected.length === 0) return [];

  await tx.assignment.updateMany({
    where: { id: { in: affected.map(a => a.id) } },
    data: { status: 'REJECTED' },
  });

  return affected;
}

/**
 * Prüft, ob sich ein neuer Zeitraum mit einem bereits erfassten überschneidet. Zwei
 * Zeiträume überschneiden sich, wenn jeder vor dem Ende des anderen beginnt; ein
 * offenes Ende zählt dabei als "unendlich".
 */
export async function findOverlappingLeave(
  tx: Prisma.TransactionClient,
  teacherId: string,
  start: Date,
  end: Date | null,
  ignoreId?: string
) {
  const existing = await tx.leavePeriod.findMany({
    where: { teacherId, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
  });

  return existing.find(other => {
    const otherStart = toLocalDayStart(other.startDate);
    const otherEnd = other.endDate ? toLocalDayStart(other.endDate) : null;
    if (otherEnd && otherEnd < start) return false;
    if (end && otherStart > end) return false;
    return true;
  }) ?? null;
}
