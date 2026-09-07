"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getCurrentSchoolYear, getLastSchoolYear, getNextSchoolYear } from "@/lib/schoolYear";

type SchulamtYearContextValue = {
  selectedYear: string;
  setSelectedYear: (year: string) => void;
  availableYears: string[];
};

const SchulamtYearContext = createContext<SchulamtYearContextValue | null>(null);

/**
 * Das Schuljahr wird im gemeinsamen Layout ausgewählt (Kopfzeile), gilt aber für alle
 * vier Schulamt-Unterseiten gemeinsam. Next.js behält den State eines Layouts über
 * Client-seitige Navigation innerhalb desselben Layouts hinweg bei, deshalb reicht ein
 * einfacher useState hier – die Auswahl bleibt beim Wechsel zwischen /schulamt,
 * /schulamt/reserven, /schulamt/statistiken und /schulamt/einstellungen erhalten, ohne
 * dass jede Seite ihr eigenes, unabhängiges Schuljahr mitschleppt.
 */
export function SchulamtYearProvider({ children }: { children: ReactNode }) {
  const [selectedYear, updateSelectedYear] = useState(getCurrentSchoolYear());
  const availableYears = [getLastSchoolYear(), getCurrentSchoolYear(), getNextSchoolYear()];
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('schulamt:selectedYear');
      if (saved && [getLastSchoolYear(), getCurrentSchoolYear(), getNextSchoolYear()].includes(saved)) updateSelectedYear(saved);
    } catch { /* Private browsing can disable storage; navigation still works. */ }
  }, []);
  const setSelectedYear = (year: string) => {
    if (!availableYears.includes(year)) return;
    updateSelectedYear(year);
    try { sessionStorage.setItem('schulamt:selectedYear', year); } catch { /* Optional persistence. */ }
  };

  return (
    <SchulamtYearContext.Provider value={{ selectedYear, setSelectedYear, availableYears }}>
      {children}
    </SchulamtYearContext.Provider>
  );
}

export function useSchulamtYear() {
  const ctx = useContext(SchulamtYearContext);
  if (!ctx) {
    throw new Error("useSchulamtYear muss innerhalb von SchulamtYearProvider verwendet werden.");
  }
  return ctx;
}
