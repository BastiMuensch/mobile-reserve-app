"use client";

import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { BatchAssignView } from "@/components/schulamt/BatchAssignView";

/**
 * Die Idealbesetzung braucht für sich selbst keine der vier Schulamt-Endpunkte - der
 * gesamte Vorschlag kommt über den eigenen /api/batch-assign/preview-Aufruf. Trotzdem
 * muss die Seite an der geteilten Schuljahr-Auswahl im Layout teilnehmen (siehe
 * statistiken/page.tsx), sonst würde useSchulamtYear() dort ohne Konsumenten dieser
 * Seite trotzdem funktionieren, aber die Absicht wäre nicht ersichtlich. Ein leeres
 * endpoints-Array ist hier die kleinstmögliche sinnvolle Wahl: kein Datenladen, aber
 * dieselbe Schuljahr-Synchronisation wie die anderen Unterseiten.
 */
export default function SchulamtIdealbesetzungPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  useSchulamtData({ endpoints: [], year: selectedYear, setYear: setSelectedYear });

  return <BatchAssignView />;
}
