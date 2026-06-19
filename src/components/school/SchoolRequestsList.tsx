import { useMemo } from "react";
import { RequestData, AssignmentData } from "@/types/models";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, Trash2, MessageSquare, HeartPulse, GraduationCap, Building } from "lucide-react";

export function SchoolRequestsList({ 
  requests, 
  loading, 
  handleCancel 
}: { 
  requests: RequestData[]; 
  loading: boolean; 
  handleCancel: (id: string) => void;
}) {
  const categories = useMemo(() => [
    { id: 'ERKRANKUNG', label: 'Ungeplanter Ausfall (Priorität 1)', icon: HeartPulse, color: 'rose' },
    { id: 'FORTBILDUNG', label: 'Fortbildung (Priorität 2)', icon: GraduationCap, color: 'blue' },
    { id: 'SCHULINTERN', label: 'Schulintern geblockt (Priorität 3)', icon: Building, color: 'slate' }
  ], []);

  const requestsByCategory = useMemo(() => {
    const grouped: Record<string, RequestData[]> = {};
    for (const cat of categories) {
      grouped[cat.id] = requests.filter(r => (r.priority || 'ERKRANKUNG') === cat.id);
    }
    return grouped;
  }, [requests, categories]);

  return (
    <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 h-full">
      <CardHeader>
        <CardTitle className="text-xl">Aktive & Ausstehende Anfragen</CardTitle>
        <CardDescription>Übersicht all Ihrer kürzlich gemeldeten Bedarfe.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-12 text-slate-500 animate-pulse">Lade Anfragen...</div>
        ) : requests.length === 0 ? (
          <div className="text-center py-16 text-slate-500 bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
            <div className="bg-slate-100 dark:bg-slate-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="h-8 w-8 text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-lg font-medium text-slate-600 dark:text-slate-400">Keine aktiven Anfragen gefunden.</p>
            <p className="text-sm mt-1">Erstellen Sie eine neue Anfrage auf der linken Seite.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {categories.map(category => {
              const categoryRequests = requestsByCategory[category.id] || [];
              if (categoryRequests.length === 0) return null;
              const Icon = category.icon;
              const colorClasses: Record<string, string> = {
                rose: 'text-rose-700 dark:text-rose-400',
                blue: 'text-blue-700 dark:text-blue-400',
                slate: 'text-slate-700 dark:text-slate-400'
              };
              return (
                <div key={category.id} className="space-y-3">
                  <h3 className={`font-semibold flex items-center gap-2 ${colorClasses[category.color]}`}>
                    <Icon className="w-5 h-5" /> {category.label}
                  </h3>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                    <Table>
                      <TableHeader className="bg-slate-50 dark:bg-slate-900/80">
                        <TableRow>
                          <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Datum</TableHead>
                          <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Klasse</TableHead>
                          <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Zeitraum</TableHead>
                          <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Qualifikation</TableHead>
                          <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Status / Zuweisung</TableHead>
                          <TableHead className="text-right font-semibold text-slate-900 dark:text-slate-100">Aktion</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {categoryRequests.map((req) => (
                          <TableRow key={req.id} className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                            <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                              {new Date(req.date).toLocaleDateString('de-DE')}
                              {req.endDate && ` - ${new Date(req.endDate).toLocaleDateString('de-DE')}`}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{req.schoolType === 'GRUNDSCHULE' ? 'GS' : req.schoolType === 'MITTELSCHULE' ? 'MS' : 'GS/MS'}</div>
                              <div className="text-xs text-slate-500">Für: {req.substitutedTeacher || '-'}</div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{req.schedule ? 'Individueller Plan' : (req.weeklyHours > req.hours ? `${req.weeklyHours} Std. gesamt` : `${req.hours} Std.`)}</div>
                              <div className="text-xs text-slate-500">{req.schedule ? `${req.weeklyHours} Std./Woche` : `ab ${req.startHour}. Std (${req.hours}h/Tag)`}</div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-slate-700 dark:text-slate-300">{req.qualifications || 'Beliebig'}</div>
                              {req.comments && (
                                <div className="text-xs text-slate-500 mt-1 flex items-center gap-1" title={req.comments}>
                                  <MessageSquare className="w-3 h-3" /> Info hinterlegt
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-start gap-1">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold shadow-sm ${
                                  req.status === 'PENDING' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30' :
                                  req.status === 'PARTIALLY_FILLED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30' :
                                  req.status === 'FILLED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30' :
                                  'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                                }`}>
                                  {req.status === 'PENDING' ? 'AUSSTEHEND' : req.status === 'PARTIALLY_FILLED' ? 'TEILWEISE' : req.status === 'FILLED' ? 'BESETZT' : req.status}
                                </span>
                                {req.assignments && req.assignments.map((assign: AssignmentData) => {
                                  const d = new Date(assign.date);
                                  const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                                  return (
                                    <div key={assign.id} className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-md border border-emerald-100 dark:border-emerald-800/30 mt-1">
                                      <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                        👤 {assign.teacher?.name || 'Unbekannt'} ({dayName}, {d.toLocaleDateString('de-DE')} - {assign.hours}h)
                                      </div>
                                      <div className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-1 pl-4">
                                        📞 {assign.teacher?.phone || 'Keine Nummer'} | ✉️ {assign.teacher?.email || 'Keine Mail'}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {req.status === 'PENDING' && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 opacity-0 group-hover:opacity-100 transition-all rounded-full h-8 w-8 p-0"
                                  onClick={() => handleCancel(req.id)}
                                  aria-label="Anfrage stornieren"
                                  title="Anfrage stornieren"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
