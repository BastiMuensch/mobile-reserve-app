import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runGdprCleanup } from '@/lib/dataRetention';

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

    const { ranAt, stats } = await runGdprCleanup();

    return NextResponse.json({
      success: true,
      message: 'DSGVO Cleanup erfolgreich durchgeführt',
      lastGdprCleanup: { ranAt, stats },
      stats
    });
  } catch (error) {
    // Der Aufrufer ist ein unbeaufsichtigter Cronjob (siehe DEPLOYMENT.md, Teil 3) -
    // ohne ein klar auffindbares Log-Signal fällt ein monatelang scheiternder Lauf
    // niemandem auf. Deshalb mit eindeutigem Präfix und vollem Fehlerobjekt loggen,
    // damit `docker compose logs` den Vorfall zeigt.
    console.error('[DSGVO-CLEANUP] Bereinigung fehlgeschlagen:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        success: false,
        error: 'DSGVO-Bereinigung fehlgeschlagen',
        details: message
      },
      { status: 500 }
    );
  }
}
