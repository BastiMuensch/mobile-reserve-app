import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { activeUnfilledDays } from './unfilledDays';
import { parseRequestChanges, type RequestChangeInput } from './requestChanges';
import { schoolFreeReason } from './schoolCalendar';
import { toLocalDateInputValue } from './dateKey';
import { assignmentLessonHours } from './assignmentTiming';
import { getRequestCoverageStatus } from './requestDays';
import { enqueueEmailInTransaction } from './emailOutbox';

export class RequestChangeConflict extends Error {}

export async function commitRequestChange(user: { id: string; role: string; schoolId?: string | null }, id: string, input: RequestChangeInput) {
  const review = input.action === 'APPROVE' || input.action === 'REJECT';
  if (user.role !== (review ? 'SCHULAMT' : 'SCHOOL')) throw new RequestChangeConflict('Kein Zugriff.');
  return await prisma.$transaction(async tx => {
      const row = await tx.request.findFirst({ where: { id: id,
        ...(review ? { school: { schulamtId: user.id } } : { schoolId: user.schoolId || '' }),
      }, include: { school: { include: { schulamt: true, user: true } }, assignments: { include: { teacher: true } } } });
      if (!row) throw new RequestChangeConflict('Anforderung nicht gefunden oder kein Zugriff.');
      const today = toLocalDateInputValue();
      const end = row.endDate ? toLocalDateInputValue(row.endDate) : row.isOpenEnded ? null : toLocalDateInputValue(row.date);
      if (input.action !== 'REJECT' && (['CANCELLED','ENDED'].includes(row.status) || row.endedAt || (end && end < today))) throw new RequestChangeConflict('Dieser Bedarf ist bereits abgeschlossen.');
      const changes = parseRequestChanges(row.lessonChanges);
      let data: Prisma.RequestUpdateInput = {};
      let body: string;
      let recipients: string[];
      if (input.action === 'PROPOSE') {
        if (row.lessonChanges !== input.previous) throw new RequestChangeConflict('Die Stundenänderungen wurden inzwischen geändert. Bitte neu laden.');
        if (input.date < today || input.date < toLocalDateInputValue(row.date) || (end && input.date > end)) throw new RequestChangeConflict('Bitte einen heutigen oder zukünftigen Tag innerhalb des Bedarfs wählen.');
        const free = schoolFreeReason(input.date);
        if (free) throw new RequestChangeConflict(`An diesem Tag erfolgt keine Unterrichtszuweisung: ${free}.`);
        if (changes.some(c => c.state === 'PENDING' && c.date === input.date)) throw new RequestChangeConflict('Für diesen Tag wartet bereits eine Änderung auf Prüfung.');
        if (changes.length >= 2000) throw new RequestChangeConflict('Für diesen Bedarf sind keine weiteren Änderungen möglich.');
        changes.push({ id: crypto.randomUUID(), date: input.date, lessons: [...input.lessons].sort((a,b) => a-b), state: 'PENDING', createdAt: new Date().toISOString() });
        data = { lessonChanges: JSON.stringify(changes) };
        body = `Änderungswunsch für ${input.date}: ${input.lessons.length} Stunden (${input.lessons.join(', ')}. Unterrichtsstunde). Bitte im Portal freigeben oder ablehnen. Bestehende Zuweisungen bleiben bis zu Ihrer Entscheidung verbindlich.`;
        recipients = [row.school.schulamt?.email || ''];
      } else if (input.action === 'COMMENT') {
        if (row.comments !== input.previous) throw new RequestChangeConflict('Der Vermerk wurde inzwischen geändert. Bitte neu laden.');
        if ((row.comments || '') === input.comments) return { ids: [], warnings: [] };
        data = { comments: input.comments || null };
        body = 'Der organisatorische Vermerk wurde geändert. Bitte lesen Sie den aktuellen Vermerk im angemeldeten Portal. Bestehende Zuweisungen bleiben verbindlich.';
        recipients = [row.school.schulamt?.email || '', ...row.assignments.filter(a => ['PENDING','ACCEPTED'].includes(a.status) && toLocalDateInputValue(a.date) >= today).map(a => a.teacher.email || '')];
      } else {
        const change = changes.find(c => c.id === input.changeId);
        if (!change) throw new RequestChangeConflict('Änderung nicht gefunden.');
        if (change.state !== 'PENDING') throw new RequestChangeConflict('Diese Änderung wurde bereits entschieden. Bitte neu laden.');
        if (input.action === 'APPROVE') {
          if ((row.status === 'UNFILLED' && !row.unfilledDays) || activeUnfilledDays(row.unfilledDays).some(d => d.date === change.date)) throw new RequestChangeConflict('Für diesen Tag liegt eine Absage vor. Bitte die Absage zuerst zurücknehmen und anschließend die Stundenänderung freigeben.');
          if (change.date < today || (end && change.date > end) || schoolFreeReason(change.date)) throw new RequestChangeConflict('Vergangene oder unterrichtsfreie Tage können nicht freigegeben werden.');
          const assignments = row.assignments.filter(a => ['PENDING','ACCEPTED'].includes(a.status) && toLocalDateInputValue(a.date) === change.date);
          if (assignments.reduce((sum,a) => sum+a.hours+(a.cancelledHours || 0),0) > change.lessons.length || assignments.some(a => {
            const slots = assignmentLessonHours(a);
            return !slots || slots.some(h => !change.lessons.includes(h));
          })) throw new RequestChangeConflict('Bestehende Zuweisungen passen nicht zum neuen Bedarf. Bitte diese zuerst in der Zuweisungsverwaltung prüfen und gegebenenfalls aufheben; danach die Änderung freigeben.');
        }
        change.state = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        change.reviewedAt = new Date().toISOString();
        data = { lessonChanges: JSON.stringify(changes) };
        body = `Ihr Änderungswunsch für ${change.date} (${change.lessons.length} Stunden) wurde ${change.state === 'APPROVED' ? 'freigegeben' : 'abgelehnt'}. Die verbindlichen Einsätze finden Sie im Portal.`;
        recipients = [row.school.user?.email || ''];
      }
      const updated = await tx.request.update({ where: { id: row.id }, data });
      await tx.request.update({ where: { id: row.id }, data: { status: getRequestCoverageStatus(updated, row.assignments) } });
      const ids: string[] = [], warnings: string[] = [];
      for (const to of new Set(recipients.filter(Boolean))) {
        const queued = await enqueueEmailInTransaction(tx, { to, schulamtId: row.school.schulamtId ?? undefined, subject: `Bedarf geändert · ${row.school.name}`, body: `Vorgang: ${row.id}\nSchule: ${row.school.name}\n\n${body}` });
        if (queued.outboxId) ids.push(queued.outboxId);
        if (queued.warning) warnings.push(queued.warning);
      }
      return { ids, warnings };
    }, { isolationLevel: 'Serializable' });
}
