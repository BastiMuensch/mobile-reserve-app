import { Prisma } from '@prisma/client';
import { toLocalDateKey, toLocalDayStart, daysCoveredByLeave } from '@/lib/matching';
import { recalculateRequestStatus } from '@/lib/leaveService';
import { sendEmail, generateIcalEvent } from '@/lib/email';
import { sendPushNotification } from '@/lib/push';

/**
 * Der Kern einer Zuweisung: prüfen, anlegen, benachrichtigen.
 *
 * Lag bisher vollständig in /api/assign. Die Sammel-Besetzung (Idealbesetzung) gibt
 * mehrere Zuweisungen auf einmal frei und braucht exakt dieselben Prüfungen – zwei
 * Kopien derselben Regeln wären eine Einladung, dass die eine irgendwann strenger ist
 * als die andere.
 */

/** Die Lehrkraft ist an mindestens einem der Zieltage bereits verplant. */
export class DoubleBookingError extends Error {
  conflictDateKeys: string[];
  constructor(conflictDateKeys: string[]) {
    super('Double booking detected');
    this.name = 'DoubleBookingError';
    this.conflictDateKeys = conflictDateKeys;
  }
}

/**
 * Die Lehrkraft ist an mindestens einem der Zieltage längerfristig abwesend
 * (Mutterschutz, Elternzeit, ...). Das Matching blendet solche Lehrkräfte bereits aus;
 * hier wird der Weg an der Kandidatenliste vorbei abgesichert.
 */
export class OnLeaveError extends Error {
  leaveDateKeys: string[];
  constructor(leaveDateKeys: string[]) {
    super('Teacher is on leave');
    this.name = 'OnLeaveError';
    this.leaveDateKeys = leaveDateKeys;
  }
}

/** Ein Tag liegt außerhalb des Zeitraums der Anforderung. */
export class OutsidePeriodError extends Error {
  dateKey: string;
  constructor(dateKey: string) {
    super('Date outside request period');
    this.name = 'OutsidePeriodError';
    this.dateKey = dateKey;
  }
}

export type AssignmentEntry = { date: string | Date; hours: number };

/** "12.05.2026" aus einem lokalen Tagesschlüssel – für Fehlermeldungen und E-Mails. */
export function formatDateKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('de-DE');
}

/**
 * Legt die Zuweisungen einer Lehrkraft für eine Anforderung an – innerhalb einer bereits
 * geöffneten Transaktion, damit der Aufrufer mehrere Zuweisungen gemeinsam abbrechen
 * kann. Wirft bei Konflikten die Fehlerklassen oben.
 */
export async function validateAndCreateAssignments(
  tx: Prisma.TransactionClient,
  input: { requestId: string; teacherId: string; entries: AssignmentEntry[] }
): Promise<{ createdCount: number }> {
  const { requestId, teacherId, entries } = input;
  if (entries.length === 0) return { createdCount: 0 };

  const request = await tx.request.findUnique({ where: { id: requestId } });
  if (!request) throw new Error(`Anforderung ${requestId} nicht gefunden.`);

  // Jeder Tag muss im Zeitraum der Anforderung liegen (date..endDate, sonst genau date).
  const periodStart = toLocalDayStart(request.date);
  const periodEnd = request.endDate ? toLocalDayStart(request.endDate) : periodStart;
  for (const entry of entries) {
    const day = toLocalDayStart(entry.date);
    if (day < periodStart || day > periodEnd) {
      throw new OutsidePeriodError(toLocalDateKey(day));
    }
  }

  const rows = entries.map(e => ({
    requestId,
    teacherId,
    date: new Date(e.date),
    hours: e.hours,
  }));

  const targetKeys = new Set(rows.map(r => toLocalDateKey(r.date)));
  const targetTimes = rows.map(r => toLocalDayStart(r.date).getTime());
  const rangeStart = new Date(Math.min(...targetTimes));
  const rangeEnd = new Date(Math.max(...targetTimes));
  rangeEnd.setHours(23, 59, 59, 999);

  // Doppelbuchung: hat die Lehrkraft an einem der Zieltage schon einen gültigen Einsatz?
  // Fängt nebenbei Doppelklicks ab.
  const existing = await tx.assignment.findMany({
    where: { teacherId, status: { not: 'REJECTED' }, date: { gte: rangeStart, lte: rangeEnd } },
    select: { date: true },
  });
  const conflictDateKeys = Array.from(new Set(
    existing.map(e => toLocalDateKey(e.date)).filter(key => targetKeys.has(key))
  ));
  if (conflictDateKeys.length > 0) throw new DoubleBookingError(conflictDateKeys);

  // Längere Abwesenheit im Zielzeitraum?
  const leaves = await tx.leavePeriod.findMany({
    where: {
      teacherId,
      OR: [{ endDate: null }, { endDate: { gte: rangeStart } }],
      startDate: { lte: rangeEnd },
    },
    select: { teacherId: true, startDate: true, endDate: true },
  });
  const leaveDateKeys = daysCoveredByLeave(leaves, Array.from(targetKeys));
  if (leaveDateKeys.length > 0) throw new OnLeaveError(leaveDateKeys);

  await tx.assignment.createMany({ data: rows });

  // Status aus dem tatsächlichen Bestand neu berechnen statt aus einer mitgeführten
  // Summe: recalculateRequestStatus schließt stornierte Zuweisungen korrekt aus (die
  // frühere Inline-Rechnung in /api/assign zählte sie mit und konnte eine Anforderung
  // dadurch verfrüht auf FILLED setzen) und respektiert eine Absage im Status UNFILLED.
  await recalculateRequestStatus(tx, requestId);

  return { createdCount: rows.length };
}

type NotifyInput = {
  teacher: { name: string; userId: string | null; user?: { email: string | null } | null };
  request: {
    startHour: number;
    schoolType: string;
    substitutedTeacher: string;
    comments: string | null;
    school: { name: string; address: string; user?: { email: string | null } | null };
  };
  entries: AssignmentEntry[];
  schulamtId: string;
};

/**
 * Benachrichtigt Lehrkraft (Push + E-Mail mit Kalendereintrag) und Schule.
 * Bewusst NACH dem Commit aufzurufen: Ein fehlgeschlagener Versand darf eine bereits
 * gespeicherte Zuweisung nicht zurückrollen.
 */
export async function notifyAssignment({ teacher, request, entries, schulamtId }: NotifyInput): Promise<void> {
  const list = entries
    .map(e => `- ${new Date(e.date).toLocaleDateString('de-DE')}: ${e.hours} Stunde(n)`)
    .join('\n');

  /** Derselbe Block für beide Mails, nur mit unterschiedlicher Überschrift. */
  const detailsWithHeading = (heading: string) =>
    `${heading}\n` +
    `Datum:\n${list}\n` +
    `Start (Unterrichtsstunde): ${request.startHour}. Stunde\n` +
    `Schulart: ${request.schoolType}\n` +
    `Zu vertreten: ${request.substitutedTeacher || 'Nicht angegeben'}\n` +
    `Besonderheiten/Kommentar:\n${request.comments || '-'}`;

  const details = detailsWithHeading('Einsatzdetails:');

  if (teacher.userId) {
    await sendPushNotification(teacher.userId, {
      title: 'Neuer Einsatz zugewiesen',
      body: `Sie wurden für neue Einsatzstunden an der Schule ${request.school.name} zugewiesen.`,
    }).catch(e => console.error('Push failed:', e));
  }

  if (teacher.user?.email) {
    const body = `Ihnen wurden neue Einsatzstunden an der Schule ${request.school.name} zugewiesen.\n\n${details}`;

    const icalEvents = entries.map(e => {
      const start = new Date(e.date);
      // Grobe Startzeit aus der Unterrichtsstunde (1. Stunde ≈ 08:00 Uhr).
      start.setHours(7 + request.startHour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(start.getHours() + e.hours);
      return {
        start,
        end,
        summary: `Mobile Reserve Einsatz: ${request.school.name}`,
        description: body,
        location: request.school.address,
      };
    });

    await sendEmail(
      teacher.user.email,
      'Neuer Einsatz zugewiesen',
      body,
      schulamtId,
      [{ filename: 'einsatz.ics', content: generateIcalEvent(icalEvents), contentType: 'text/calendar' }]
    );
  }

  if (request.school.user?.email) {
    await sendEmail(
      request.school.user.email,
      'Zuweisung einer Lehrkraft',
      `Der Anforderung wurde die Lehrkraft ${teacher.name} zugewiesen.\n\n${detailsWithHeading('Zuweisungsdetails:')}`,
      schulamtId
    );
  }
}

type NotifyCancelInput = {
  teacher: { name: string; userId: string | null; user?: { email: string | null } | null };
  schoolName: string;
  entries: AssignmentEntry[];
  schulamtId: string;
  /** Kurze Begründung für die Lehrkraft, z.B. "Die Lehrkraft ist zurück." */
  reason: string;
};

/**
 * Teilt einer Lehrkraft mit, dass Einsätze entfallen – per Push und E-Mail.
 *
 * Gegenstück zu notifyAssignment. Bewusst mit Push: Eine gestrichene Fahrt zu einer
 * Schule muss die Lehrkraft zuverlässig erreichen, eine E-Mail allein wird womöglich
 * erst am Abend gelesen. Fehler beim Versand werden geloggt, nicht geworfen – die
 * Stornierung ist zu diesem Zeitpunkt bereits gespeichert.
 */
export async function notifyAssignmentsCancelled({
  teacher, schoolName, entries, schulamtId, reason
}: NotifyCancelInput): Promise<void> {
  const list = entries
    .map(e => `- ${new Date(e.date).toLocaleDateString('de-DE')}: ${e.hours} Stunde(n)`)
    .join('\n');

  if (teacher.userId) {
    await sendPushNotification(teacher.userId, {
      title: 'Einsatz entfällt',
      body: `Ihre Einsätze an der Schule ${schoolName} wurden storniert.`,
    }).catch(e => console.error('Push failed:', e));
  }

  if (teacher.user?.email) {
    await sendEmail(
      teacher.user.email,
      'Einsatz storniert',
      `Folgende Einsätze an der Schule ${schoolName} entfallen:\n\n${list}\n\n` +
      `Grund: ${reason}\n\n` +
      `Bitte tragen Sie die Termine aus Ihrem Kalender aus.`,
      schulamtId
    ).catch(e => console.error('Stornierungs-Mail fehlgeschlagen:', e));
  }
}
