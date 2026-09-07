let isRedirecting = false;

/**
 * Navigates centrally and exactly once to the login page when a 401 Unauthorized occurs,
 * preventing cascading refresh loops or repeated navigation attempts.
 */
export function handleUnauthorized() {
  if (typeof window === 'undefined' || isRedirecting) return;
  if (window.location.pathname === '/') return;
  isRedirecting = true;
  window.location.replace('/');
}

export function resetUnauthorizedState() {
  isRedirecting = false;
}
