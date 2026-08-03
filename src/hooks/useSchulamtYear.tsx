"use client";

import { createContext, useContext, useState, ReactNode } from "react";
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
  const [selectedYear, setSelectedYear] = useState(getCurrentSchoolYear());
  const availableYears = [getLastSchoolYear(), getCurrentSchoolYear(), getNextSchoolYear()];

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
