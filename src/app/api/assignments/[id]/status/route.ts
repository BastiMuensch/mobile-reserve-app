import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { z } from 'zod';

/**
 * Bestätigung eines Einsatzes durch die Lehrkraft.
 *
 * Lehrkräfte können einen zugewiesenen Einsatz ausschließlich BESTÄTIGEN – ein
 * Ablehnen ist bewusst nicht vorgesehen: Über die Einsatzvergabe entscheidet das
 * Schulamt. Kann eine Lehrkraft einen Einsatz tatsächlich nicht wahrnehmen, ist dafür
 * die Ausfallmeldung (/api/teachers/absence) der richtige Weg; nur sie setzt
 * Zuweisungen auf REJECTED und gibt den Bedarf wieder frei.
 */
const StatusSchema = z.object({
  status: z.literal('ACCEPTED', {
    message: 'Ein Einsatz kann nur bestätigt werden. Für eine Absage nutzen Sie bitte die Ausfallmeldung.',
  }),
});

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawData = await request.json();
    const parsed = StatusSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        teacher: true,
        request: {
          include: {
            school: {
              include: {
                schulamt: true
              }
            }
          }
        }
      }
    });

    if (!assignment || assignment.teacher.userId !== userSession.id) {
      return NextResponse.json({ error: 'Not your assignment' }, { status: 403 });
    }

    // Eine bereits per Ausfallmeldung stornierte Zuweisung darf nicht nachträglich
    // wieder bestätigt werden – sie wurde inzwischen ggf. neu vergeben.
    if (assignment.status === 'REJECTED') {
      return NextResponse.json(
        { error: 'Dieser Einsatz wurde bereits storniert und kann nicht mehr bestätigt werden.' },
        { status: 409 }
      );
    }

    const updatedAssignment = await prisma.assignment.update({
      where: { id: params.id },
      data: { status: 'ACCEPTED' }
    });

    const schulamtEmail = assignment.request.school.schulamt?.email;
    if (schulamtEmail) {
      const dateStr = new Date(assignment.date).toLocaleDateString('de-DE');
      const emailBody = `Die Lehrkraft ${assignment.teacher.name} hat den Einsatz an der Schule ${assignment.request.school.name} am ${dateStr} bestätigt.`;
      await sendEmail(schulamtEmail, `Einsatz bestätigt: ${assignment.teacher.name}`, emailBody, assignment.request.school.schulamt?.id);
    }

    return NextResponse.json(updatedAssignment);
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error: 'Ein interner Fehler ist aufgetreten.' }, { status: 500 });
  }
}
