"use client";

import { useEffect, useState } from "react";
import { toLocalDateInputValue } from "@/lib/dateKey";

/** The German school day also advances when a PWA stays open overnight. */
export function useCurrentDateKey() {
  const [today, setToday] = useState(() => toLocalDateInputValue());
  useEffect(() => {
    const update = () => setToday(toLocalDateInputValue());
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    window.addEventListener("app-refresh", update);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      window.removeEventListener("app-refresh", update);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return today;
}
