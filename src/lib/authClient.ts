let isRedirecting = false;

/**
 * Navigates centrally and exactly once to the login page when a 401 Unauthorized occurs,
 * preventing cascading refresh loops or repeated navigation attempts.
 */
export function handleUnauthorized() {
  if (typeof window === 'undefined') return;
  // Consumers on the root route cannot rely on a navigation to clear their stale
  // in-memory session. Notify them before the redirect guard below returns.
  window.dispatchEvent(new Event('auth-invalidated'));
  if (isRedirecting) return;
  if (window.location.pathname === '/') return;
  isRedirecting = true;
  window.location.replace('/');
}

export function resetUnauthorizedState() {
  isRedirecting = false;
}
