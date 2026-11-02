import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { canCorrectAssignmentHours, hourCorrectionSchema } from '@/lib/assignmentHours';
import { deliverOutboxIds, enqueueEmailInTransaction } from '@/lib/emailOutbox';

class CorrectionConflict extends Error {}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== 'SCHOOL' || !user.schoolId) return NextResponse.json({ error: 'Nur die Einsatzschule kann eine Stundenkorrektur melden.' }, { status: 403 });
  try {
    const parsed = hourCorrectionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { id } = await params;
    const result = await prisma.$transaction(async tx => {
      const assignment = await tx.assignment.findFirst({ where: { id, request: { schoolId: user.schoolId! } }, include: {
        teacher: { select: { name: true } }, request: { include: { school: { include: { schulamt: true } } } },
      } });
      if (!assignment) return null;
      if (assignment.request.status === 'CANCELLED' || !canCorrectAssignmentHours(assignment)) throw new CorrectionConflict('Korrekturen sind für bestätigte Einsätze bis einschließlich heute möglich.');
      if (await tx.assignmentHourCorrection.findFirst({ where: { assignmentId: id, status: 'PENDING' } })) throw new CorrectionConflict('Für diesen Einsatz wartet bereits eine Korrektur auf Prüfung.');
      const correction = await tx.assignmentHourCorrection.create({ data: {
        assignmentId: id, plannedHours: assignment.hours, previousActualHours: assignment.actualHours,
        previousAdditionalMinutes: assignment.actualAdditionalMinutes, ...parsed.data,
        additionalTasks: parsed.data.additionalTasks || null, submittedById: user.id,
      } });
      const office = assignment.request.school.schulamt;
      const queued = office ? await enqueueEmailInTransaction(tx, {
        schulamtId: office.id, to: office.email, subject: 'Stundenkorrektur zur Prüfung',
        body: `${assignment.request.school.name} hat für ${assignment.teacher.name} am ${assignment.date.toLocaleDateString('de-DE', { timeZone: 'UTC' })} eine Stundenkorrektur gemeldet.\nGeplant: ${assignment.hours} UStd.\nGemeldet: ${parsed.data.proposedHours} UStd. und ${parsed.data.additionalMinutes} Minuten zusätzliche Aufgaben.\nBitte prüfen Sie die Meldung beim Bedarf im Portal.`,
      }) : null;
      return { correction, outboxId: queued?.outboxId };
    }, { isolationLevel: 'Serializable' });
    if (!result) return NextResponse.json({ error: 'Einsatz nicht gefunden.' }, { status: 404 });
    if (result.outboxId) await deliverOutboxIds([result.outboxId]).catch(() => undefined);
    return NextResponse.json(result.correction, { status: 201 });
  } catch (error) {
    if (error instanceof CorrectionConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) return NextResponse.json({ error: 'Der Einsatz wurde inzwischen geändert oder hat bereits eine offene Korrektur. Bitte neu laden.' }, { status: 409 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ungültige Eingabe.' }, { status: 400 });
    console.error('Stundenkorrektur fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Die Stundenkorrektur konnte nicht gespeichert werden.' }, { status: 500 });
  }
}
