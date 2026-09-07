let isRedirecting = false;

// These forms intentionally work without a session. Match exact page paths,
// never prefixes: a 401 must not discard their invitation/reset query token.
const PUBLIC_ENTRY_PATHS = new Set(['/', '/register/teacher', '/reset']);

/**
 * Invalidates the session on every 401 and redirects protected pages once.
 * Public entry forms remain open so their own token validation can run.
 */
export function handleUnauthorized() {
  if (typeof window === 'undefined') return;
  // Consumers on the root route cannot rely on a navigation to clear their stale
  // in-memory session. Notify them before the redirect guard below returns.
  window.dispatchEvent(new Event('auth-invalidated'));
  if (isRedirecting) return;
  if (PUBLIC_ENTRY_PATHS.has(window.location.pathname)) return;
  isRedirecting = true;
  window.location.replace('/');
}

export function resetUnauthorizedState() {
  isRedirecting = false;
}
