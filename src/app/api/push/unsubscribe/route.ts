import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { z } from 'zod';

const UnsubscribeSchema = z.object({
  endpoint: z.string().min(1, 'endpoint ist erforderlich'),
});

// Removes a PushSubscription so a logged-out user stops receiving pushes on a shared device
// (e.g. a school tablet). This route is called from AuthProvider.logout() BEFORE the session
// cookie is cleared, so we can require + verify a valid session here and scope the delete to
// subscriptions owned by that user - a caller can never delete someone else's subscription just
// by knowing (or guessing) their endpoint URL.
export async function POST(req: Request) {
  try {
    const userSession = await getSessionUser();
    if (!userSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawData = await req.json();
    const parsed = UnsubscribeSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { endpoint } = parsed.data;

    // deleteMany (not delete) so an already-removed or foreign endpoint is a harmless no-op
    // instead of a P2025 "record not found" error - the caller just wants "not subscribed".
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: userSession.id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to unsubscribe from push:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
