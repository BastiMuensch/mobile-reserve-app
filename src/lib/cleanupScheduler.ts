import { runGdprCleanup, readLastCleanup } from '@/lib/dataRetention';

/**
 * In-Process-Scheduler für die DSGVO-Bereinigung.
 *
 * Ersetzt den früher von Hand angelegten Linux-Cronjob: Der Zeitplan lebt jetzt im
 * Code und ist nach jedem Deployment automatisch aktiv. Der HTTP-Endpunkt
 * /api/cron/cleanup bleibt zusätzlich bestehen – für manuelles Auslösen und für
 * Umgebungen, in denen der Container nicht durchläuft (z.B. Plattformen, die ihn bei
 * Inaktivität schlafen legen); dort ist ein externer Cron weiterhin der sicherere Weg.
 *
 * Warum kein verteiltes Lock: Die Bereinigung ist idempotent. Anonymisierungen sind
 * durch den Platzhalter-Guard gegen Wiederholung geschützt, Löschungen finden beim
 * zweiten Lauf schlicht nichts mehr vor. Zwei Instanzen, die zufällig gleichzeitig
 * starten, richten also keinen Schaden an – der Preis wäre lediglich ein überflüssiger
 * Lauf.
 */

// Wie oft geprüft wird, ob ein Lauf fällig ist. Die Prüfung selbst ist eine einzelne
// Zeile aus SystemSetting und damit vernachlässigbar.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // stündlich

// Frühestens so lange nach dem letzten Lauf wieder ausführen. Bewusst unter 24 h, damit
// ein Lauf nicht Tag für Tag später rutscht und irgendwann aus dem Nachtfenster fällt.
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 Stunden

// Bevorzugtes Zeitfenster (lokale Serverzeit). Nachts, damit die Transaktion mit ihren
// Löschungen nicht in die Arbeitszeit der Schulämter fällt.
const PREFERRED_WINDOW_START_HOUR = 1;
const PREFERRED_WINDOW_END_HOUR = 5;

// Notfallgrenze: Lief die Bereinigung so lange nicht (z.B. weil der Container jede Nacht
// neu startet oder tagsüber erst hochgefahren wurde), wird das Nachtfenster ignoriert.
// Eine gesetzliche Löschfrist darf nicht daran scheitern, dass nie 02:00 Uhr "getroffen"
// wurde.
const OVERDUE_MS = 36 * 60 * 60 * 1000; // 36 Stunden

function isInPreferredWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= PREFERRED_WINDOW_START_HOUR && hour < PREFERRED_WINDOW_END_HOUR;
}

async function runIfDue(): Promise<void> {
  const now = new Date();

  const last = await readLastCleanup();
  const elapsedMs = last ? now.getTime() - new Date(last.ranAt).getTime() : Number.POSITIVE_INFINITY;

  if (elapsedMs < MIN_INTERVAL_MS) return;

  // Innerhalb der ersten 36 h nur im Nachtfenster laufen; danach unabhängig davon.
  if (elapsedMs < OVERDUE_MS && !isInPreferredWindow(now)) return;

  console.log('[DSGVO-CLEANUP] Geplanter Lauf wird gestartet.');
  const result = await runGdprCleanup();
  console.log('[DSGVO-CLEANUP] Geplanter Lauf abgeschlossen.', result.stats);
}

async function tick(): Promise<void> {
  try {
    await runIfDue();
  } catch (error) {
    // Ein Fehler darf den Scheduler nicht beenden - beim nächsten Tick wird es erneut
    // versucht. Der Zeitstempel bleibt so lange alt und macht das Problem sichtbar.
    console.error('[DSGVO-CLEANUP] Geplanter Lauf fehlgeschlagen:', error);
  }
}

export function startCleanupScheduler(): void {
  if (process.env.GDPR_CLEANUP_SCHEDULER === 'off') {
    console.log('[DSGVO-CLEANUP] Scheduler per GDPR_CLEANUP_SCHEDULER=off deaktiviert.');
    return;
  }

  // Im Dev-Modus lädt Next die Instrumentation bei Hot Reloads erneut. Ohne diesen Guard
  // liefen mit der Zeit mehrere Timer parallel.
  const globalRef = globalThis as unknown as { __gdprCleanupSchedulerStarted?: boolean };
  if (globalRef.__gdprCleanupSchedulerStarted) return;
  globalRef.__gdprCleanupSchedulerStarted = true;

  if (!process.env.DATABASE_URL) {
    console.warn('[DSGVO-CLEANUP] DATABASE_URL nicht gesetzt - Scheduler wird nicht gestartet.');
    return;
  }

  const timer = setInterval(() => {
    void tick();
  }, CHECK_INTERVAL_MS);

  // Der Timer soll den Prozess nicht am Beenden hindern (z.B. bei docker compose down).
  timer.unref?.();

  // Ein erster Check kurz nach dem Start, aber bewusst verzögert und NICHT awaited:
  // register() muss abgeschlossen sein, bevor der Server Requests annimmt - eine
  // Bereinigung dort würde den Start blockieren.
  const initialCheck = setTimeout(() => {
    void tick();
  }, 60 * 1000);
  initialCheck.unref?.();

  console.log('[DSGVO-CLEANUP] Scheduler aktiv (stündliche Prüfung, Lauf einmal täglich).');
}

/** Nur für Diagnosezwecke: verrät, ob der Scheduler in diesem Prozess läuft. */
export function isSchedulerRunning(): boolean {
  const globalRef = globalThis as unknown as { __gdprCleanupSchedulerStarted?: boolean };
  return globalRef.__gdprCleanupSchedulerStarted === true;
}
