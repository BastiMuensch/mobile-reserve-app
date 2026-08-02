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

  const remaining = await tx.assignment.findMany({
    where: { requestId, status: { not: 'REJECTED' } },
    select: { hours: true },
  });
  const filledHours = remaining.reduce((sum, a) => sum + a.hours, 0);

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
