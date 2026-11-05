const HISTORY_INDEX = '__mobileReserveHistoryIndex';
const HISTORY_PAGE = '__mobileReserveHistoryPage';
const MESSAGE = 'Sie haben nicht gespeicherte Änderungen. Seite wirklich verlassen?';
const dirtyForms = new Set<symbol>();
let initialized = false;

function historyIndex(state: unknown): number | null {
  if (!state || typeof state !== 'object') return null;
  const index = (state as Record<string, unknown>)[HISTORY_INDEX];
  return typeof index === 'number' && Number.isSafeInteger(index) ? index : null;
}

function sameRoute(first: string, second: string): boolean {
  const a = new URL(first);
  const b = new URL(second);
  return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
}

/** A page can contain several dirty forms; leaving it needs one confirmation. */
export function confirmUnsavedNavigation(): boolean {
  return dirtyForms.size === 0 || window.confirm(MESSAGE);
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirtyForms.size) return;
  event.preventDefault();
  event.returnValue = '';
}

function beforeLinkNavigation(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
  const destination = new URL(anchor.href, window.location.href);
  if (destination.origin !== window.location.origin || sameRoute(destination.href, window.location.href)) return;
  if (!confirmUnsavedNavigation()) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/**
 * Install before hydration (instrumentation-client), so every App Router entry
 * receives an index. Preserve Next's history state without depending on its keys.
 * No sentinel entries are added: cancelling Back/Forward traverses back to the
 * original entry and leaves both the form and the forward history intact.
 */
export function initializeUnsavedNavigationGuard() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const originalPush = window.history.pushState.bind(window.history);
  const originalReplace = window.history.replaceState.bind(window.history);
  let currentIndex = historyIndex(window.history.state) ?? 0;
  let currentUrl = window.location.href;
  let currentPage = typeof window.history.state?.[HISTORY_PAGE] === 'string'
    ? window.history.state[HISTORY_PAGE] as string
    : crypto.randomUUID();
  let currentState: unknown = window.history.state;
  let restoringIndex: number | null = null;
  const indexedState = (state: unknown, index: number, page: string) => ({
    ...(state && typeof state === 'object' ? state : {}),
    [HISTORY_INDEX]: index,
    [HISTORY_PAGE]: page,
  });
  originalReplace(indexedState(window.history.state, currentIndex, currentPage), '', currentUrl);
  currentState = window.history.state;

  window.history.pushState = (state, unused, url) => {
    const nextIndex = currentIndex + 1;
    const destination = new URL(url ?? currentUrl, currentUrl).href;
    const hashOnly = destination !== currentUrl && sameRoute(destination, currentUrl);
    const nextPage = hashOnly ? currentPage : crypto.randomUUID();
    originalPush(indexedState(state, nextIndex, nextPage), unused, url);
    currentIndex = nextIndex;
    currentPage = nextPage;
    currentUrl = window.location.href;
    currentState = window.history.state;
  };
  window.history.replaceState = (state, unused, url) => {
    const destination = new URL(url ?? currentUrl, currentUrl).href;
    const nextPage = sameRoute(destination, currentUrl) ? currentPage : crypto.randomUUID();
    originalReplace(indexedState(state, currentIndex, nextPage), unused, url);
    currentPage = nextPage;
    currentUrl = window.location.href;
    currentState = window.history.state;
  };

  // Native anchors/location.hash can create entries without calling pushState.
  // Give those entries their own index while retaining the current router state.
  const recordNativeHash = () => {
    const index = historyIndex(window.history.state);
    if (restoringIndex !== null || currentUrl === window.location.href || !sameRoute(currentUrl, window.location.href) ||
        (index !== null && index !== currentIndex)) return false;
    currentIndex += 1;
    currentUrl = window.location.href;
    originalReplace(indexedState(currentState, currentIndex, currentPage), '', currentUrl);
    currentState = window.history.state;
    return true;
  };

  // Capture runs before the App Router's popstate listener. A rejected traversal
  // must never reach React, otherwise unmounting would already destroy the draft.
  window.addEventListener('popstate', (event: PopStateEvent) => {
    if (recordNativeHash()) return;
    const targetIndex = historyIndex(event.state);
    if (restoringIndex !== null) {
      event.stopImmediatePropagation();
      if (targetIndex === restoringIndex) {
        restoringIndex = null;
      } else if (targetIndex !== null) {
        window.history.go(restoringIndex - targetIndex);
      }
      return;
    }

    if (targetIndex !== null && event.state?.[HISTORY_PAGE] !== currentPage && !confirmUnsavedNavigation()) {
      event.stopImmediatePropagation();
      restoringIndex = currentIndex;
      window.history.go(currentIndex - targetIndex);
      return;
    }
    // An unindexed entry predates this document; cross-document traversal is
    // protected by beforeunload, rather than guessing its position in history.
    if (targetIndex !== null) currentIndex = targetIndex;
    currentPage = typeof event.state?.[HISTORY_PAGE] === 'string' ? event.state[HISTORY_PAGE] : crypto.randomUUID();
    currentUrl = window.location.href;
    currentState = event.state;
  }, true);
  window.addEventListener('hashchange', recordNativeHash, true);
}

export function registerUnsavedForm(): () => void {
  initializeUnsavedNavigationGuard();
  const token = Symbol('unsaved form');
  if (dirtyForms.size === 0) {
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeLinkNavigation, true);
  }
  dirtyForms.add(token);
  return () => {
    dirtyForms.delete(token);
    if (dirtyForms.size === 0) {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', beforeLinkNavigation, true);
    }
  };
}

export function confirmFormDiscard(hasUnsavedChanges: boolean): boolean {
  return !hasUnsavedChanges || window.confirm(MESSAGE);
}
