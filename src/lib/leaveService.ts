import { Prisma } from '@prisma/client';
import { toCanonicalUtcDate } from '@/lib/dateKey';
import { getOpenRequestDays } from '@/lib/requestDays';

/**
 * Datenbankseitige Logik für längere Abwesenheiten. Reine Hilfsfunktionen ohne
 * Datenbankzugriff stehen in src/lib/leave.ts, damit sie auch im Browser nutzbar sind.
 */

/** Setzt die Grenzen eines Zeitraums auf kanonische UTC-Tagesgrenzen (Ende einschließlich). */
export function normalizeLeaveRange(startDate: string | Date, endDate?: string | Date | null) {
  const start = toCanonicalUtcDate(startDate);
  if (!endDate) return { start, end: null as Date | null };
  const end = toCanonicalUtcDate(endDate);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Berechnet den Status einer Anforderung neu, nachdem Zuweisungen geändert oder storniert wurden.
 * Verwendet die zentrale Tageslogik getOpenRequestDays:
 * - Keine gültige Zuweisung: PENDING
 * - Mindestens eine gültige Zuweisung und noch offene Tage/Stunden: PARTIALLY_FILLED
 * - Kein offener Tag bei einem befristeten Bedarf: FILLED
 * - Ein offener Bedarf ohne Enddatum bleibt bis zur Rückkehr höchstens PARTIALLY_FILLED
 * - UNFILLED wird nur durch ausdrückliche Rücknahme wieder geöffnet
 */
export async function recalculateRequestStatus(tx: Prisma.TransactionClient, requestId: string) {
  const request = await tx.request.findUnique({
    where: { id: requestId },
    include: {
      assignments: {
        where: { status: { not: 'REJECTED' } },
        select: { date: true, hours: true, status: true },
      },
    },
  });
  if (!request) return;

  // Eine vom Schulamt bewusst als "keine Reserve verfügbar" markierte Anforderung
  // (Status UNFILLED) wird hier NICHT automatisch wieder geöffnet.
  if (request.status === 'UNFILLED') return;

  const assignments = request.assignments ?? [];

  // Ein Bedarf "bis auf Weiteres" wird nie FILLED.
  if (request.isOpenEnded && !request.endDate) {
    await tx.request.update({
      where: { id: requestId },
      data: { status: assignments.length === 0 ? 'PENDING' : 'PARTIALLY_FILLED' },
    });
    return;
  }

  const openDays = getOpenRequestDays(request, assignments);

  const status = assignments.length === 0
    ? 'PENDING'
    : openDays.length === 0 ? 'FILLED' : 'PARTIALLY_FILLED';

  await tx.request.update({ where: { id: requestId }, data: { status } });
}

/**
 * Storniert alle noch gültigen Einsätze der Lehrkraft im Abwesenheitszeitraum und gibt
 * die betroffenen Anforderungen wieder frei. Ohne Enddatum gilt der Zeitraum als offen,
 * es werden also alle Einsätze ab Beginn storniert.
 * Berücksichtigt optional alle Teacher-Einträge derselben Person (userId).
 */
export async function cancelAssignmentsInLeaveRange(
  tx: Prisma.TransactionClient,
  teacherId: string,
  start: Date,
  end: Date | null,
  userId?: string | null
) {
  const teacherIds = userId
    ? (await tx.teacher.findMany({ where: { userId }, select: { id: true } })).map(t => t.id)
    : [teacherId];

  const affected = await tx.assignment.findMany({
    where: {
      teacherId: { in: teacherIds },
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
 */
export async function cancelAssignmentsAfter(
  tx: Prisma.TransactionClient,
  requestId: string,
  lastDay: Date
) {
  const cutoff = toCanonicalUtcDate(lastDay);
  cutoff.setUTCHours(23, 59, 59, 999);

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
 * Prüft, ob sich ein neuer Zeitraum mit einem bereits erfassten überschneidet.
 * Berücksichtigt optional alle Schuljahreseinträge derselben Person (userId).
 */
export async function findOverlappingLeave(
  tx: Prisma.TransactionClient,
  teacherId: string,
  start: Date,
  end: Date | null,
  ignoreId?: string | string[],
  userId?: string | null
) {
  const teacherIds = userId
    ? (await tx.teacher.findMany({ where: { userId }, select: { id: true } })).map(t => t.id)
    : [teacherId];

  const ignoreList = Array.isArray(ignoreId) ? ignoreId : (ignoreId ? [ignoreId] : []);

  const existing = await tx.leavePeriod.findMany({
    where: {
      teacherId: { in: teacherIds },
      ...(ignoreList.length > 0 ? { id: { notIn: ignoreList } } : {}),
    },
  });

  return existing.find(other => {
    const otherStart = toCanonicalUtcDate(other.startDate);
    const otherEnd = other.endDate ? toCanonicalUtcDate(other.endDate) : null;
    if (otherEnd && otherEnd < start) return false;
    if (end && otherStart > end) return false;
    return true;
  }) ?? null;
}
