"use client";

import { useSchulamtYear } from '@/hooks/useSchulamtYear';
import { GovernmentReportPanel } from '@/components/schulamt/GovernmentReportPanel';

export default function GovernmentReportPage() {
  const { selectedYear } = useSchulamtYear();
  return <GovernmentReportPanel key={selectedYear} schoolYear={selectedYear} />;
}
