import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getSessionUser } from '@/lib/auth';
import { requestChangeInputSchema } from '@/lib/requestChanges';
import { commitRequestChange, RequestChangeConflict } from '@/lib/requestChangeService';
import { deliverOutboxIds } from '@/lib/emailOutbox';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  const parsed = requestChangeInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bitte gültige Stunden und Angaben eingeben.' }, { status: 400 });
  const input = parsed.data;
  const review = input.action === 'APPROVE' || input.action === 'REJECT';
  if (user.role !== (review ? 'SCHULAMT' : 'SCHOOL')) return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403 });
  try {
    const result = await commitRequestChange(user, (await params).id, input);
    // A delivery failure must never turn a committed change into a failed save.
    await deliverOutboxIds(result.ids).catch(() => undefined);
    return NextResponse.json({ ok: true, warnings: result.warnings });
  } catch (error) {
    if (error instanceof RequestChangeConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return NextResponse.json({ error: 'Der Bedarf wurde gleichzeitig geändert. Bitte neu laden und erneut prüfen.' }, { status: 409 });
    return NextResponse.json({ error: 'Die Änderung konnte nicht sicher gespeichert werden. Bitte erneut versuchen.' }, { status: 503 });
  }
}
