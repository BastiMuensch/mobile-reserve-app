import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { recalculateRequestStatus } from '@/lib/leaveService';

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        teacher: true,
        request: {
          include: { school: true }
        }
      }
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Security: verify this assignment belongs to a school under the user's Schulamt
    if (assignment.request.school.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: Assignment does not belong to your Schulamt.' }, { status: 403 });
    }

    // Löschen und Status-Neuberechnung gemeinsam, damit kein Zwischenstand entsteht.
    //
    // Die frühere Inline-Rechnung hier hatte drei Fehler: Sie zählte auch stornierte
    // Zuweisungen mit, konnte FILLED nie erreichen (eine noch vollständig besetzte
    // Anforderung fiel also auf PARTIALLY_FILLED zurück) und überschrieb sogar den
    // Status UNFILLED - eine Absage, über die die Schule per E-Mail informiert wurde,
    // wäre damit unbemerkt wieder aufgelebt. recalculateRequestStatus behandelt alle
    // drei Fälle korrekt und ist die einzige Stelle, an der der Status berechnet wird.
    await prisma.$transaction(async (tx) => {
      await tx.assignment.delete({ where: { id: params.id } });
      await recalculateRequestStatus(tx, assignment.requestId);
    });

    // Notify teacher
    if (assignment.teacher.email) {
      const dateStr = new Date(assignment.date).toLocaleDateString('de-DE');
      await sendEmail(
        assignment.teacher.email,
        'Zuweisung aufgehoben / storniert',
        `Hallo ${assignment.teacher.name},\n\nIhre Zuweisung für die Schule ${assignment.request.school.name} am ${dateStr} wurde vom Schulamt storniert/aufgehoben.\n\nBitte prüfen Sie Ihr Dashboard für aktuelle Einsätze.`,
        userSession.id
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error: 'Ein interner Fehler ist aufgetreten.' }, { status: 500 });
  }
}
