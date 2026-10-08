"use client";

import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { Statistics } from "@/components/schulamt/Statistics";
import { WorkloadStatistics } from '@/components/schulamt/WorkloadStatistics';

export default function SchulamtStatistikenPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  const data = useSchulamtData({ endpoints: ["teachers", "requests"], year: selectedYear, setYear: setSelectedYear });

  return (
    <div className="max-w-6xl space-y-8">
      <WorkloadStatistics schoolYear={selectedYear} revision={data.revision} />
      <Statistics
        requests={data.requests}
      />
    </div>
  );
}
