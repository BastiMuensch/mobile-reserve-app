"use client";

import { useCallback, useEffect } from "react";
import { confirmFormDiscard, registerUnsavedForm } from '@/lib/unsavedNavigation';
export { confirmUnsavedNavigation } from '@/lib/unsavedNavigation';

/** Warn before leaving a page with local edits; hash navigation stays harmless. */
export function useUnsavedChanges(hasUnsavedChanges: boolean) {
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    return registerUnsavedForm();
  }, [hasUnsavedChanges]);
  return useCallback(() => confirmFormDiscard(hasUnsavedChanges), [hasUnsavedChanges]);
}
