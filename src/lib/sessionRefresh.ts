const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;

/** Renew only while the app is being used; background polling/push is not activity. */
export function startSessionRefresh(onUnauthorized: () => void): () => void {
  let stopped = false;
  let nextAttempt = 0;
  let pending: AbortController | null = null;

  const refresh = async () => {
    if (stopped || pending || document.visibilityState !== 'visible' || navigator.onLine === false || Date.now() < nextAttempt) return;
    const controller = new AbortController();
    pending = controller;
    nextAttempt = Date.now() + RETRY_INTERVAL_MS;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST', cache: 'no-store', signal: controller.signal,
      });
      if (stopped || controller.signal.aborted) return;
      if (response.ok) nextAttempt = Date.now() + REFRESH_INTERVAL_MS;
      else if (response.status === 401) {
        stopped = true;
        onUnauthorized();
      }
    } catch {
      // Offline and transient failures leave the current session intact.
      // Retry on subsequent activity, not in a background timer loop.
    } finally {
      clearTimeout(timeout);
      pending = null;
    }
  };

  const onActivity = () => { void refresh(); };
  const events = ['focus', 'online', 'pointerdown', 'keydown', 'scroll'] as const;
  for (const event of events) window.addEventListener(event, onActivity, { passive: true, capture: true });
  document.addEventListener('visibilitychange', onActivity);
  onActivity();

  return () => {
    stopped = true;
    pending?.abort();
    for (const event of events) window.removeEventListener(event, onActivity, { capture: true });
    document.removeEventListener('visibilitychange', onActivity);
  };
}
