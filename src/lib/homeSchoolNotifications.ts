import type { Prisma } from '@prisma/client';
import { enqueueEmailInTransaction } from './emailOutbox';

type AssignmentEvent = 'ASSIGNED' | 'ACCEPTED' | 'CANCELLED' | 'ENDED';

const eventLabels: Record<AssignmentEvent, string> = {
  ASSIGNED: 'Neuer Einsatz zugewiesen',
  ACCEPTED: 'Einsatz bestätigt',
  CANCELLED: 'Einsatz abgesagt',
  ENDED: 'Einsatzende festgelegt',
};

/** Only operational assignment facts are read: no absence reasons or request comments. */
export async function enqueueHomeSchoolNotifications(
  tx: Prisma.TransactionClient,
  input: { where: Prisma.AssignmentWhereInput; event: AssignmentEvent; schulamtId?: string | null; lastDay?: Date },
): Promise<{ outboxIds: string[]; warnings: string[] }> {
  const outboxIds: string[] = [];
  const warnings: string[] = [];
  const assignments = await tx.assignment.findMany({
    where: input.where,
    select: {
      id: true, date: true, hours: true, status: true,
      teacher: { select: {
        name: true,
        stammschule: { select: {
          id: true, schulamtId: true, reserveNotificationsEnabled: true,
          user: { select: { email: true, role: true, isActive: true } },
        } },
      } },
      request: { select: { school: { select: { name: true, schulamtId: true } } } },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  const groups = new Map<string, { to: string; schulamtId: string; lines: string[] }>();
  for (const assignment of assignments) {
    const home = assignment.teacher.stammschule;
    const destination = assignment.request.school;
    // Never disclose a destination from another tenant, including legacy/imported rows.
    if (!home.reserveNotificationsEnabled || !home.schulamtId ||
      home.schulamtId !== destination.schulamtId ||
      (input.schulamtId && home.schulamtId !== input.schulamtId) ||
      home.user?.role !== 'SCHOOL' || !home.user.isActive || !home.user.email.trim()) continue;
    if (input.event !== 'CANCELLED' && assignment.status === 'REJECTED') continue;
    const group = groups.get(home.id) ?? { to: home.user.email.trim(), schulamtId: home.schulamtId, lines: [] };
    const day = assignment.date.toLocaleDateString('de-DE', { timeZone: 'UTC' });
    group.lines.push(`- ${assignment.teacher.name}: ${destination.name}, ${day}, ${assignment.hours} Stunde(n)`);
    groups.set(home.id, group);
  }

  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  let portal = 'Die aktuelle Übersicht finden Sie im Portal unter „Unsere Mobilen Reserven“.';
  if (configuredUrl) {
    try {
      const url = new URL(configuredUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        portal += `\n${new URL('/schule/reserven', url).toString()}`;
      }
    } catch { /* A missing/invalid public URL must not block assignment changes. */ }
  }
  for (const group of groups.values()) {
    const end = input.lastDay ? `\nLetzter Einsatztag: ${input.lastDay.toLocaleDateString('de-DE', { timeZone: 'UTC' })}. Spätere Einsätze dieser Anforderung entfallen.\n` : '';
    const queued = await enqueueEmailInTransaction(tx, {
      to: group.to,
      schulamtId: group.schulamtId,
      subject: `Mobile Reserve: ${eventLabels[input.event]}`,
      body: `${eventLabels[input.event]}\n\nFür Mobile Reserven Ihrer Stammschule gibt es eine neue Einsatzmeldung:\n${group.lines.join('\n')}\n${end}\n${portal}`,
    });
    if (queued.outboxId) outboxIds.push(queued.outboxId);
    if (queued.warning) warnings.push(queued.warning);
  }
  return { outboxIds, warnings };
}
