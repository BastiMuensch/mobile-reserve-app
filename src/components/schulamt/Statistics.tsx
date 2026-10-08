import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { RequestData } from '@/types/models';
import { ChartSize, getChartSize } from '@/components/schulamt/chartSize';
import { REQUEST_PRIORITY_OPTIONS, requestPriorityCategory } from '@/lib/requestPriority';

function MeasuredChart({ children }: { children: (size: ChartSize) => React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChartSize | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = (width: number, height: number) => {
      const nextSize = getChartSize(width, height);
      setSize(currentSize => (
        currentSize?.width === nextSize?.width && currentSize?.height === nextSize?.height
          ? currentSize
          : nextSize
      ));
    };

    const measure = () => {
      const { width, height } = container.getBoundingClientRect();
      updateSize(width, height);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full min-w-0 w-full">
      {size && children(size)}
    </div>
  );
}

export function Statistics({ requests }: { requests: RequestData[] }) {
  
  // Gemeldete Bedarfe, einschließlich später stornierter Meldungen.
  const priorityData = useMemo(() => {
    const counts = new Map<string, number>(REQUEST_PRIORITY_OPTIONS.map(option => [option.value, 0]));
    requests.forEach(r => {
      const category = requestPriorityCategory(r.priority);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });
    return REQUEST_PRIORITY_OPTIONS.map(option => ({ name: option.label, value: counts.get(option.value) ?? 0 })).filter(entry => entry.value > 0);
  }, [requests]);

  // Bedarf nach Schulart
  const schoolTypeData = useMemo(() => {
    const counts: Record<string, number> = {
      'Grundschule': 0,
      'Mittelschule': 0,
      'Grund- und Mittelschule': 0,
      'Unbekannt': 0
    };
    requests.forEach(r => {
      if (r.schoolType === 'GRUNDSCHULE') counts['Grundschule']++;
      else if (r.schoolType === 'MITTELSCHULE') counts['Mittelschule']++;
      else if (r.schoolType === 'GS_MS') counts['Grund- und Mittelschule']++;
      else counts['Unbekannt']++;
    });
    return Object.entries(counts).filter((entry) => entry[1] > 0).map(([name, value]) => ({ name, value }));
  }, [requests]);

  const COLORS = ['#f97316', '#3b82f6', '#10b981', '#f43f5e', '#8b5cf6'];

  return (
    <div className="animate-in space-y-8 fade-in duration-500">
      <p className="text-sm text-muted-foreground">Gemeldete Bedarfe im ausgewählten Schuljahr, einschließlich später stornierter Meldungen. Die Diagramme zählen Bedarfe, keine Unterrichtsstunden.</p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:gap-8">
        
        {/* Priority Pie Chart */}
        <Card className="min-w-0 border-border/70 bg-white py-5 dark:bg-card">
          <CardHeader className="px-5 sm:px-6">
            <CardTitle className="text-foreground">Gründe für Anforderungen</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px] min-w-0 px-3 sm:px-6">
            {priorityData.length > 0 ? (
              <MeasuredChart>
                {({ width, height }) => <PieChart width={width} height={height}>
                  <Pie data={priorityData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" label>
                    {priorityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>}
              </MeasuredChart>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">Keine Daten vorhanden</div>
            )}
          </CardContent>
        </Card>

        {/* SchoolType Pie Chart */}
        <Card className="min-w-0 border-border/70 bg-white py-5 dark:bg-card">
          <CardHeader className="px-5 sm:px-6">
            <CardTitle className="text-foreground">Bedarf nach Schulart</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px] min-w-0 px-3 sm:px-6">
             {schoolTypeData.length > 0 ? (
              <MeasuredChart>
                {({ width, height }) => <PieChart width={width} height={height}>
                  <Pie data={schoolTypeData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" label>
                    {schoolTypeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>}
              </MeasuredChart>
             ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">Keine Daten vorhanden</div>
             )}
          </CardContent>
        </Card>


      </div>
    </div>
  );
}
