/**
 * Wird von Next.js einmal beim Start einer Server-Instanz aufgerufen, bevor der erste
 * Request bedient wird (siehe node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
 *
 * Hier wird der Zeitplan für die DSGVO-Bereinigung gestartet. Dadurch entfällt der
 * früher von Hand anzulegende Linux-Cronjob: Der Zeitplan ist nach jedem Deployment
 * automatisch aktiv.
 *
 * WICHTIG: register() muss abgeschlossen sein, bevor der Server Requests annimmt.
 * Hier darf deshalb nur der Timer registriert und keinesfalls die Bereinigung selbst
 * ausgeführt werden - sonst verzögert sich jeder Serverstart um deren Laufzeit.
 */
export async function register() {
  // Next ruft register() in allen Laufzeiten auf. Der Scheduler braucht Prisma und
  // Node-Timer, läuft also ausschließlich in der Node.js-Laufzeit.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startCleanupScheduler } = await import('@/lib/cleanupScheduler');
  startCleanupScheduler();
}
