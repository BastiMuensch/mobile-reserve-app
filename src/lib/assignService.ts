import { Prisma } from '@prisma/client';
import { toLocalDateKey, daysCoveredByLeave } from '@/lib/matching';
import { recalculateRequestStatus } from '@/lib/leaveService';
import { sendEmail, generateIcalEvent } from '@/lib/email';
import { enqueueEmailInTransaction } from '@/lib/emailOutbox';
import { sendPushNotification } from '@/lib/push';
import { getSchoolYearForDate } from '@/lib/schoolYear';
import { isValidDateKey, parseDateKeyStrict, toCanonicalUtcDate } from '@/lib/dateKey';
import { getOpenRequestDays } from '@/lib/requestDays';

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

/** Die Lehrkraft hat für mindestens einen Zieltag einen ungeplanten Ausfall gemeldet. */
export class AbsenceConflictError extends Error {
  dateKeys: string[];
  constructor(dateKeys: string[]) {
    super('Teacher has reported absence');
    this.name = 'AbsenceConflictError';
    this.dateKeys = dateKeys;
  }
}

/** Die Lehrkraft ist nicht im Status ACTIVE. */
export class TeacherInactiveError extends Error {
  status: string;
  constructor(status: string) {
    super(`Teacher is not active (status: ${status})`);
    this.name = 'TeacherInactiveError';
    this.status = status;
  }
}

/** Angefragte Stunden überschreiten den noch offenen Bedarf. */
export class HoursExceededError extends Error {
  dateKey: string;
  requestedHours: number;
  openHours: number;
  constructor(dateKey: string, requestedHours: number, openHours: number) {
    super(`Requested hours (${requestedHours}) exceed open hours (${openHours}) for ${dateKey}`);
    this.name = 'HoursExceededError';
    this.dateKey = dateKey;
    this.requestedHours = requestedHours;
    this.openHours = openHours;
  }
}

/** Derselbe Tag kommt mehrfach im Zuweisungs-Payload vor. */
export class DuplicateDayInPayloadError extends Error {
  constructor() {
    super('Duplicate day in assignment payload');
    this.name = 'DuplicateDayInPayloadError';
  }
}

/** Mandantenprüfung fehlgeschlagen (Schulamt-Konflikt). */
export class TenantMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantMismatchError';
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

/** Die gewählte Jahreszeile der Lehrkraft passt nicht zum Einsatztag. */
export class SchoolYearMismatchError extends Error {
  constructor() {
    super('Teacher belongs to a different school year');
    this.name = 'SchoolYearMismatchError';
  }
}

export type AssignmentEntry = { date: string | Date; hours: number };

export type AssignServiceResult = {
  createdCount: number;
  warning?: string;
};

/**
 * Kombiniert Personen- und Zeitraumfilter bewusst mit AND. Zwei OR-Schlüssel im
 * selben JavaScript-Objekt würden sich gegenseitig überschreiben und könnten dadurch
 * eine Abwesenheit einer anderen Lehrkraft als Konflikt behandeln.
 */
export function buildTeacherLeaveOverlapWhere(
  teacherId: string,
  userId: string | null,
  rangeStart: Date,
  rangeEnd: Date
): Prisma.LeavePeriodWhereInput {
  return {
    AND: [
      userId
        ? {
            OR: [
              { teacherId },
              { teacher: { userId } },
            ],
          }
        : { teacherId },
      { startDate: { lte: rangeEnd } },
      { OR: [{ endDate: null }, { endDate: { gte: rangeStart } }] },
    ],
  };
}

/** "12.05.2026" aus einem lokalen Tagesschlüssel – für Fehlermeldungen und E-Mails. */
export function formatDateKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('de-DE');
}

function getUtcWeekRange(date: Date): { weekStart: Date; weekEnd: Date; weekKey: string } {
  const day = date.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const diffToMon = (day + 6) % 7;
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - diffToMon);
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  return { weekStart, weekEnd, weekKey: weekStart.toISOString().slice(0, 10) };
}

/**
 * Legt die Zuweisungen einer Lehrkraft für eine Anforderung an – innerhalb einer bereits
 * geöffneten Transaktion, damit der Aufrufer mehrere Zuweisungen gemeinsam abbrechen
 * kann. Wirft bei Konflikten die definierten Fehlerklassen.
 */
export async function validateAndCreateAssignments(
  tx: Prisma.TransactionClient,
  input: { requestId: string; teacherId: string; entries: AssignmentEntry[]; schulamtId?: string }
): Promise<AssignServiceResult> {
  const { requestId, teacherId, entries, schulamtId } = input;
  if (entries.length === 0) return { createdCount: 0 };

  // 1. Eingaben strikt validieren und kanonisieren
  const parsedEntries: { dateKey: string; canonicalDate: Date; hours: number }[] = [];
  for (const entry of entries) {
    const rawDate = typeof entry.date === 'string'
      ? entry.date
      : toLocalDateKey(toCanonicalUtcDate(entry.date));
    if (!isValidDateKey(rawDate)) {
      throw new Error(`Ungültiger Datumsschlüssel: ${rawDate}`);
    }
    const canonicalDate = parseDateKeyStrict(rawDate);
    if (!canonicalDate) {
      throw new Error(`Ungültiges Datum: ${rawDate}`);
    }
    if (typeof entry.hours !== 'number' || entry.hours <= 0 || !Number.isInteger(entry.hours)) {
      throw new Error(`Ungültige Stundenzahl für ${rawDate}: ${entry.hours}`);
    }
    parsedEntries.push({ dateKey: rawDate, canonicalDate, hours: entry.hours });
  }

  // Doppelte Tage im selben Payload ablehnen
  const dateKeys = parsedEntries.map(e => e.dateKey);
  if (new Set(dateKeys).size !== dateKeys.length) {
    throw new DuplicateDayInPayloadError();
  }

  // 2. Anforderung und Lehrkraft innerhalb der Transaktion laden
  const request = await tx.request.findUnique({
    where: { id: requestId },
    include: {
      school: { select: { id: true, schulamtId: true } },
      assignments: {
        where: { status: { not: 'REJECTED' } },
        select: { date: true, hours: true, status: true },
      },
    },
  });
  if (!request) throw new Error(`Anforderung ${requestId} nicht gefunden.`);

  if (schulamtId && request.school.schulamtId !== schulamtId) {
    throw new TenantMismatchError('Forbidden: Anforderung gehört nicht zu Ihrem Schulamt.');
  }

  const teacher = await tx.teacher.findUnique({
    where: { id: teacherId },
    include: { stammschule: { select: { id: true, schulamtId: true } } },
  });
  if (!teacher) throw new Error(`Lehrkraft ${teacherId} nicht gefunden.`);

  if (schulamtId && teacher.stammschule?.schulamtId !== schulamtId) {
    throw new TenantMismatchError('Forbidden: Lehrkraft gehört nicht zu Ihrem Schulamt.');
  }

  // Nur ACTIVE zulassen
  if (teacher.status !== 'ACTIVE') {
    throw new TeacherInactiveError(teacher.status);
  }

  // 3. Schuljahres- und Zeitraumprüfung
  const periodStart = toCanonicalUtcDate(request.date);
  const periodEnd = request.endDate
    ? toCanonicalUtcDate(request.endDate)
    : (request.isOpenEnded ? null : periodStart);

  for (const entry of parsedEntries) {
    if (getSchoolYearForDate(entry.canonicalDate) !== teacher.schoolYear) {
      throw new SchoolYearMismatchError();
    }
    if (entry.canonicalDate < periodStart || (periodEnd && entry.canonicalDate > periodEnd)) {
      throw new OutsidePeriodError(entry.dateKey);
    }
  }

  // 4. Sicherstellen, dass Stunden den noch offenen Bedarf je Tag nicht überschreiten
  const openDays = getOpenRequestDays(request, request.assignments);
  const openHoursByDay = new Map(openDays.map(d => [d.date, d.hours]));
  for (const entry of parsedEntries) {
    const openForDay = openHoursByDay.get(entry.dateKey) ?? 0;
    if (entry.hours > openForDay) {
      throw new HoursExceededError(entry.dateKey, entry.hours, openForDay);
    }
  }

  // 5. Doppelbuchungsprüfung
  const canonicalDates = parsedEntries.map(e => e.canonicalDate);
  const existingAssignments = await tx.assignment.findMany({
    where: {
      teacherId,
      status: { not: 'REJECTED' },
      date: { in: canonicalDates },
    },
    select: { date: true },
  });
  if (existingAssignments.length > 0) {
    const conflictKeys = existingAssignments.map(a => toLocalDateKey(toCanonicalUtcDate(a.date)));
    throw new DoubleBookingError(conflictKeys);
  }

  // 6. Tagesgenaue Absence-Prüfung
  const absences = await tx.absence.findMany({
    where: {
      teacherId,
      date: { in: canonicalDates },
    },
    select: { date: true },
  });
  if (absences.length > 0) {
    const absenceKeys = absences.map(a => toLocalDateKey(toCanonicalUtcDate(a.date)));
    throw new AbsenceConflictError(absenceKeys);
  }

  // 7. Längere Abwesenheiten (personenbezogen über userId)
  const minTime = Math.min(...canonicalDates.map(d => d.getTime()));
  const maxTime = Math.max(...canonicalDates.map(d => d.getTime()));
  const rangeStart = new Date(minTime);
  const rangeEnd = new Date(maxTime);
  rangeEnd.setUTCHours(23, 59, 59, 999);

  const leaves = await tx.leavePeriod.findMany({
    where: buildTeacherLeaveOverlapWhere(teacherId, teacher.userId, rangeStart, rangeEnd),
    select: { teacherId: true, startDate: true, endDate: true },
  });
  const leaveDateKeys = daysCoveredByLeave(leaves, dateKeys);
  if (leaveDateKeys.length > 0) throw new OnLeaveError(leaveDateKeys);

  // 8. Wochenarbeitszeit (maxWeeklyHours) und Überstundenwarnung
  const warnings: string[] = [];
  const weekGroups = new Map<string, { weekStart: Date; weekEnd: Date; entries: typeof parsedEntries }>();
  for (const entry of parsedEntries) {
    const { weekStart, weekEnd, weekKey } = getUtcWeekRange(entry.canonicalDate);
    const group = weekGroups.get(weekKey);
    if (group) group.entries.push(entry);
    else weekGroups.set(weekKey, { weekStart, weekEnd, entries: [entry] });
  }

  for (const { weekStart, weekEnd, entries: weekEntries } of weekGroups.values()) {
    const existingWeekAssignments = await tx.assignment.findMany({
      where: {
        teacherId,
        status: { not: 'REJECTED' },
        date: { gte: weekStart, lte: weekEnd },
      },
      select: { hours: true },
    });
    const currentHours = existingWeekAssignments.reduce((sum, a) => sum + a.hours, 0);
    const addedHours = weekEntries.reduce((sum, e) => sum + e.hours, 0);
    const totalHours = currentHours + addedHours;

    // Fachliche Regel abgeleitet aus matching.ts:
    // In Notsituationen/Personalmangel lässt das System Mehrarbeit/Überstunden zu
    // (im Matching mit SCORE_OVERTIME_PENALTY gewichtet statt hart ausgefiltert).
    // Daher blockieren wir Zuweisungen bei Überstunden nicht, sondern geben eine
    // explizite Warnung im Ergebnis zurück.
    if (totalHours > teacher.maxWeeklyHours) {
      warnings.push(
        `Die Zuweisung überschreitet in der Woche vom ${weekStart.toLocaleDateString('de-DE')} die reguläre Wochenarbeitszeit von ${teacher.maxWeeklyHours} Stunden (geplant: ${totalHours} Stunden).`
      );
    }
  }

  // 9. Zuweisungen anlegen und Status aktualisieren
  const rows = parsedEntries.map(e => ({
    requestId,
    teacherId,
    date: e.canonicalDate,
    hours: e.hours,
  }));

  await tx.assignment.createMany({ data: rows });
  await recalculateRequestStatus(tx, requestId);

  return {
    createdCount: rows.length,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
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

export type QueuedNotificationResult = { outboxIds: string[]; warnings: string[] };

/** Builds and persists assignment emails within the caller's business transaction. */
export async function enqueueAssignmentEmailsInTransaction(
  tx: Prisma.TransactionClient,
  { teacher, request, entries, schulamtId }: NotifyInput,
): Promise<QueuedNotificationResult> {
  const outboxIds: string[] = [];
  const warnings: string[] = [];
  const list = entries.map(e => `- ${new Date(e.date).toLocaleDateString('de-DE')}: ${e.hours} Stunde(n)`).join('\n');
  const detailsWithHeading = (heading: string) =>
    `${heading}\nDatum:\n${list}\nStart (Unterrichtsstunde): ${request.startHour}. Stunde\n` +
    `Schulart: ${request.schoolType}\nZu vertreten: ${request.substitutedTeacher || 'Nicht angegeben'}\n` +
    `Besonderheiten/Kommentar:\n${request.comments || '-'}`;

  if (teacher.user?.email) {
    const body = `Ihnen wurden neue Einsatzstunden an der Schule ${request.school.name} zugewiesen.\n\n${detailsWithHeading('Einsatzdetails:')}`;
    const events = entries.map(e => {
      const start = new Date(e.date);
      start.setHours(7 + request.startHour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(start.getHours() + e.hours);
      return { start, end, summary: `Mobile Reserve Einsatz: ${request.school.name}`, description: body, location: request.school.address };
    });
    const queued = await enqueueEmailInTransaction(tx, {
      to: teacher.user.email, subject: 'Neuer Einsatz zugewiesen', body, schulamtId,
      attachments: [{ filename: 'einsatz.ics', content: generateIcalEvent(events), contentType: 'text/calendar' }],
    });
    if (queued.outboxId) outboxIds.push(queued.outboxId);
    if (queued.warning) warnings.push(queued.warning);
  }

  if (request.school.user?.email) {
    const queued = await enqueueEmailInTransaction(tx, {
      to: request.school.user.email,
      subject: 'Zuweisung einer Lehrkraft',
      body: `Der Anforderung wurde die Lehrkraft ${teacher.name} zugewiesen.\n\n${detailsWithHeading('Zuweisungsdetails:')}`,
      schulamtId,
    });
    if (queued.outboxId) outboxIds.push(queued.outboxId);
    if (queued.warning) warnings.push(queued.warning);
  }
  return { outboxIds, warnings };
}

/** Teacher push is intentionally post-commit; push has no durable transaction. */
export async function notifyAssignmentPush(teacher: NotifyInput['teacher'], schoolName: string): Promise<string[]> {
  if (!teacher.userId) return [];
  try {
    await sendPushNotification(teacher.userId, {
      title: 'Neuer Einsatz zugewiesen',
      body: `Sie wurden für neue Einsatzstunden an der Schule ${schoolName} zugewiesen.`,
    });
    return [];
  } catch (error) {
    console.error('Push failed:', error);
    return ['Die Push-Benachrichtigung an die Lehrkraft konnte nicht zugestellt werden.'];
  }
}

export type NotificationResult = {
  delivered: boolean;
  warnings: string[];
};

/** Execute all recipients even when one transport fails. */
export async function runIndependentNotificationTasks(
  tasks: readonly (() => Promise<string | null>)[],
  onError: (error: unknown) => void = (error) => console.error('Benachrichtigungsempfänger fehlgeschlagen:', error),
): Promise<string[]> {
  const warnings: string[] = [];
  for (const task of tasks) {
    try {
      const warning = await task();
      if (warning) warnings.push(warning);
    } catch (error) {
      onError(error);
      warnings.push('Eine Benachrichtigung konnte nicht verarbeitet werden.');
    }
  }
  return warnings;
}

/**
 * Benachrichtigt Lehrkraft (Push + E-Mail mit Kalendereintrag) und Schule.
 * Bewusst NACH dem Commit aufzurufen: Ein fehlgeschlagener Versand darf eine bereits
 * gespeicherte Zuweisung nicht zurückrollen.
 */
export async function notifyAssignment({ teacher, request, entries, schulamtId }: NotifyInput): Promise<NotificationResult> {
  const warnings: string[] = [];
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
    const pushed = await sendPushNotification(teacher.userId, {
      title: 'Neuer Einsatz zugewiesen',
      body: `Sie wurden für neue Einsatzstunden an der Schule ${request.school.name} zugewiesen.`,
    }).then(() => true).catch(e => {
      console.error('Push failed:', e);
      return false;
    });
    if (!pushed) warnings.push('Die Push-Benachrichtigung an die Lehrkraft konnte nicht zugestellt werden.');
  }

  if (teacher.user?.email) {
    try {
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

      const delivered = await sendEmail(
        teacher.user.email,
        'Neuer Einsatz zugewiesen',
        body,
        schulamtId,
        [{ filename: 'einsatz.ics', content: generateIcalEvent(icalEvents), contentType: 'text/calendar' }]
      );
      if (!delivered) warnings.push('Die E-Mail an die Lehrkraft wurde nicht sofort zugestellt. Prüfen Sie gegebenenfalls die Mail-Warteschlange.');
    } catch (error) {
      console.error('Zuweisungs-Mail an Lehrkraft fehlgeschlagen:', error);
      warnings.push('Die E-Mail an die Lehrkraft konnte nicht verarbeitet werden.');
    }
  }

  if (request.school.user?.email) {
    try {
      const delivered = await sendEmail(
        request.school.user.email,
        'Zuweisung einer Lehrkraft',
        `Der Anforderung wurde die Lehrkraft ${teacher.name} zugewiesen.\n\n${detailsWithHeading('Zuweisungsdetails:')}`,
        schulamtId
      );
      if (!delivered) warnings.push('Die E-Mail an die Schule wurde nicht sofort zugestellt. Prüfen Sie gegebenenfalls die Mail-Warteschlange.');
    } catch (error) {
      console.error('Zuweisungs-Mail an Schule fehlgeschlagen:', error);
      warnings.push('Die E-Mail an die Schule konnte nicht verarbeitet werden.');
    }
  }

  return { delivered: warnings.length === 0, warnings };
}

type NotifyCancelInput = {
  teacher: { name: string; userId: string | null; user?: { email: string | null } | null };
  schoolName: string;
  entries: AssignmentEntry[];
  schulamtId: string;
  /** Kurze Begründung für die Lehrkraft, z.B. "Die Lehrkraft ist zurück." */
  reason: string;
};

/** Persists the cancellation email before the caller commits its business change. */
export async function enqueueCancellationEmailInTransaction(
  tx: Prisma.TransactionClient,
  { teacher, schoolName, entries, schulamtId, reason }: NotifyCancelInput,
): Promise<QueuedNotificationResult> {
  if (!teacher.user?.email) return { outboxIds: [], warnings: [] };
  const list = entries
    .map(e => `- ${new Date(e.date).toLocaleDateString('de-DE')}: ${e.hours} Stunde(n)`)
    .join('\n');
  const queued = await enqueueEmailInTransaction(tx, {
    to: teacher.user.email,
    subject: 'Einsatz storniert',
    body: `Folgende Einsätze an der Schule ${schoolName} entfallen:\n\n${list}\n\n` +
      `Grund: ${reason}\n\n` +
      'Bitte tragen Sie die Termine aus Ihrem Kalender aus.',
    schulamtId,
  });
  return {
    outboxIds: queued.outboxId ? [queued.outboxId] : [],
    warnings: queued.warning ? [queued.warning] : [],
  };
}

/**
 * Teilt einer Lehrkraft mit, dass Einsätze entfallen – per Push nach dem Commit.
 *
 * Die E-Mail wird vorher mit enqueueCancellationEmailInTransaction dauerhaft
 * eingereiht. So ist Push hier bewusst die einzige externe Aktion.
 */
export async function notifyAssignmentsCancelled({ teacher, schoolName }: NotifyCancelInput): Promise<NotificationResult> {
  const warnings: string[] = [];
  if (teacher.userId) {
    const pushed = await sendPushNotification(teacher.userId, {
      title: 'Einsatz entfällt',
      body: `Ihre Einsätze an der Schule ${schoolName} wurden storniert.`,
    }).then(() => true).catch(e => {
      console.error('Push failed:', e);
      return false;
    });
    if (!pushed) warnings.push('Die Push-Benachrichtigung an die Lehrkraft konnte nicht zugestellt werden.');
  }

  return { delivered: warnings.length === 0, warnings };
}
