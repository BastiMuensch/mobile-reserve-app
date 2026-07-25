import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';

// ACHTUNG: Dieser Endpunkt arbeitet bewusst mandantenübergreifend (systemweite
// DSGVO-Bereinigung über alle Schulen hinweg). Er ist NICHT über das normale
// Session-Cookie geschützt, sondern ausschließlich über das CRON_SECRET im
// Authorization-Header erreichbar und deshalb auch in der Proxy-Datei als
// öffentliche Route gelistet.
function isAuthorized(authHeader: string | null): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Wird separat behandelt, siehe Aufrufer
    return false;
  }

  const expected = `Bearer ${cronSecret}`;
  const provided = authHeader ?? '';

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  // timingSafeEqual wirft bei unterschiedlicher Länge, daher vorher angleichen
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('CRON_SECRET ist nicht gesetzt – DSGVO-Bereinigung wird verweigert.');
      return NextResponse.json(
        { error: 'Server-Konfigurationsfehler: CRON_SECRET ist nicht gesetzt' },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get('authorization');
    if (!isAuthorized(authHeader)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const now = new Date();
    
    // 1. Anonymize teacher names in requests older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);
    
    const anonymizedRequests = await prisma.request.updateMany({
      where: {
        date: { lt: thirtyDaysAgo },
        substitutedTeacher: { not: '*** gelöscht (DSGVO) ***' }
      },
      data: {
        substitutedTeacher: '*** gelöscht (DSGVO) ***'
      }
    });

    // 2. Delete assignments older than 400 days
    const fourHundredDaysAgo = new Date();
    fourHundredDaysAgo.setDate(now.getDate() - 400);

    const deletedAssignments = await prisma.assignment.deleteMany({
      where: {
        date: { lt: fourHundredDaysAgo }
      }
    });

    // 3. Delete requests older than 400 days
    const deletedRequests = await prisma.request.deleteMany({
      where: {
        date: { lt: fourHundredDaysAgo }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'DSGVO Cleanup erfolgreich durchgeführt',
      stats: {
        anonymizedTeacherNames: anonymizedRequests.count,
        deletedAssignments: deletedAssignments.count,
        deletedRequests: deletedRequests.count
      }
    });
  } catch (error) {
    console.error('DSGVO Cleanup Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
