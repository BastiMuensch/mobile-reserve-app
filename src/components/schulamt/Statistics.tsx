import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TeacherData, RequestData } from '@/types/models';

export function Statistics({ teachers, requests }: { teachers: TeacherData[], requests: RequestData[] }) {
  
  // 1. Auslastung der Lehrkräfte
  const utilizationData = useMemo(() => {
    return teachers.map(t => {
      const assigned = t.assignedHours || 0;
      return {
        name: t.name,
        'Max. Stunden': t.maxWeeklyHours,
        'Verplante Stunden': assigned,
        'Freie Stunden': Math.max(0, t.maxWeeklyHours - assigned)
      };
    });
  }, [teachers]);

  // 2. Bedarfsgründe
  const priorityData = useMemo(() => {
    const counts: Record<string, number> = {
      'Ungeplanter Ausfall': 0,
      'Geplant / Mutterschutz': 0,
      'Fortbildung': 0,
      'Sonstiges': 0
    };
    requests.forEach(r => {
      if (r.priority === 'ERKRANKUNG') counts['Ungeplanter Ausfall']++;
      else if (r.priority === 'MUTTERSCHUTZ') counts['Geplant / Mutterschutz']++;
      else if (r.priority === 'FORTBILDUNG') counts['Fortbildung']++;
      else counts['Sonstiges']++;
    });
    return Object.entries(counts).filter((entry) => entry[1] > 0).map(([name, value]) => ({ name, value }));
  }, [requests]);

  // 3. Bedarf nach Schulart
  const schoolTypeData = useMemo(() => {
    const counts: Record<string, number> = {
      'Grundschule': 0,
      'Mittelschule': 0,
      'Unbekannt': 0
    };
    requests.forEach(r => {
      if (r.schoolType === 'GRUNDSCHULE') counts['Grundschule']++;
      else if (r.schoolType === 'MITTELSCHULE') counts['Mittelschule']++;
      else counts['Unbekannt']++;
    });
    return Object.entries(counts).filter((entry) => entry[1] > 0).map(([name, value]) => ({ name, value }));
  }, [requests]);

  const COLORS = ['#f97316', '#3b82f6', '#10b981', '#f43f5e', '#8b5cf6'];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Priority Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-slate-700 dark:text-slate-200">Gründe für Anforderungen</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {priorityData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={priorityData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" label>
                    {priorityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-slate-500">Keine Daten vorhanden</div>
            )}
          </CardContent>
        </Card>

        {/* SchoolType Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-slate-700 dark:text-slate-200">Bedarf nach Schulart</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
             {schoolTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={schoolTypeData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" label>
                    {schoolTypeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
             ) : (
                <div className="flex h-full items-center justify-center text-slate-500">Keine Daten vorhanden</div>
             )}
          </CardContent>
        </Card>

        {/* Utilization Bar Chart */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-slate-700 dark:text-slate-200">Auslastung der Mobilen Reserven</CardTitle>
          </CardHeader>
          <CardContent className="h-[400px]">
             {utilizationData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={utilizationData} margin={{ top: 20, right: 30, left: 0, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip />
                  <Legend verticalAlign="top" height={36}/>
                  <Bar dataKey="Verplante Stunden" stackId="a" fill="#f97316" />
                  <Bar dataKey="Freie Stunden" stackId="a" fill="#e2e8f0" />
                </BarChart>
              </ResponsiveContainer>
             ) : (
               <div className="flex h-full items-center justify-center text-slate-500">Keine Daten vorhanden</div>
             )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
