"use client";

import { useCallback, useEffect } from "react";

const activeConfirmations = new Set<() => boolean>();

/** For button-driven navigation/logout outside the component that owns the form. */
export function confirmUnsavedNavigation(): boolean {
  for (const confirm of activeConfirmations) {
    if (!confirm()) return false;
  }
  return true;
}

/** Warn before leaving a page with local edits; hash navigation stays harmless. */
export function useUnsavedChanges(hasUnsavedChanges: boolean) {
  const message = "Sie haben nicht gespeicherte Änderungen. Seite wirklich verlassen?";
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const beforeNavigation = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target || anchor.hasAttribute("download") || !anchor.href.startsWith(window.location.origin)) return;
      const destination = new URL(anchor.href);
      if ((destination.pathname === window.location.pathname && destination.hash) || anchor.href === window.location.href) return;
      if (!window.confirm(message)) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigation, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", beforeNavigation, true); };
  }, [hasUnsavedChanges, message]);

  const confirmDiscard = useCallback(() => !hasUnsavedChanges || window.confirm(message), [hasUnsavedChanges, message]);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    activeConfirmations.add(confirmDiscard);
    return () => { activeConfirmations.delete(confirmDiscard); };
  }, [confirmDiscard, hasUnsavedChanges]);
  return confirmDiscard;
}
