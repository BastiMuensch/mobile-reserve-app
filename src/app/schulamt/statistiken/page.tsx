"use client";

import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { Statistics } from "@/components/schulamt/Statistics";

export default function SchulamtStatistikenPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  const data = useSchulamtData({ endpoints: ["teachers", "requests"], year: selectedYear, setYear: setSelectedYear });

  return (
    <Statistics
      teachers={data.teachers.filter(t => t.status !== 'PENDING')}
      requests={data.requests}
    />
  );
}
