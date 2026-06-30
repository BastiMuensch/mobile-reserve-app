import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Navigation, Calendar, FileDown, MessageSquare } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { RequestData, TeacherData, AssignmentData } from "@/types/models";

/** Reusable button to revoke a single assignment with confirmation & error handling */
function DeleteAssignmentButton({ assignId, isDeleting, setIsDeleting, loadData }: {
  assignId: string; isDeleting: boolean; setIsDeleting: (v: boolean) => void; loadData: () => void;
}) {
  return (
    <button
      disabled={isDeleting}
      onClick={async (e) => {
        e.stopPropagation();
        if (isDeleting) return;
        if (confirm("Möchten Sie diese Zuweisung wirklich aufheben? Die Lehrkraft wird benachrichtigt.")) {
          setIsDeleting(true);
          try {
            const res = await fetch(`/api/assignments/${assignId}`, { method: 'DELETE' });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              alert(`Fehler beim Aufheben: ${err.error || 'Unbekannter Fehler'}`);
              return;
            }
            loadData();
          } catch (error) {
            console.error('Delete assignment error:', error);
            alert('Netzwerkfehler beim Aufheben der Zuweisung.');
          } finally {
            setIsDeleting(false);
          }
        }
      }}
      className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-1.5 py-0.5 rounded transition-colors"
      title="Zuweisung aufheben"
    >
      Aufheben
    </button>
  );
}

interface RequestsListProps {
  filteredRequests: RequestData[];
  searchRequestQuery: string;
  setSearchRequestQuery: (val: string) => void;
  activeRequest: RequestData | null;
  handleMatch: (req: RequestData) => void;
  candidates: TeacherData[];
  openAssignModal: (candidate: TeacherData) => void;
  isDeleting: boolean;
  setIsDeleting: (val: boolean) => void;
  loadData: () => void;
}

export function RequestsList({
  filteredRequests,
  searchRequestQuery,
  setSearchRequestQuery,
  activeRequest,
  handleMatch,
  candidates,
  openAssignModal,
  isDeleting,
  setIsDeleting,
  loadData
}: RequestsListProps) {
  return (
    <>
      <Card id="matching-engine" className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 transition-all">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl">Bedarfsübersicht & Matching Engine</CardTitle>
            <CardDescription>Wählen Sie eine ausstehende Anfrage, um die besten Kandidaten zu ermitteln.</CardDescription>
          </div>
          <Input 
            placeholder="Suche (Schule, Grund)..." 
            value={searchRequestQuery}
            onChange={e => setSearchRequestQuery(e.target.value)}
            className="w-64 bg-white/50 dark:bg-slate-900/50 border-slate-200/60 dark:border-slate-800/60 rounded-xl focus-visible:ring-primary focus-visible:border-primary"
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredRequests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').length === 0 ? (
              <p className="text-slate-500 italic py-4 col-span-full">Keine ausstehenden Anfragen gefunden.</p>
            ) : (
              filteredRequests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').map(req => (
                <div 
                  key={req.id} 
                  onClick={() => handleMatch(req)}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col justify-between h-full ${
                    activeRequest?.id === req.id 
                      ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-4 ring-indigo-500/10 transform scale-[1.02]' 
                      : 'border-slate-200 dark:border-slate-800 hover:border-indigo-300 bg-white dark:bg-slate-900 shadow-sm hover:shadow-md'
                  }`}
                >
                  <div className="font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center justify-between">
                    {req.school.name}
                    {req.status === 'PARTIALLY_FILLED' && <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Teilweise</Badge>}
                  </div>
                  <div className="flex justify-between items-center text-sm text-slate-600 dark:text-slate-400 mb-2">
                    <span>{new Date(req.date).toLocaleDateString('de-DE')}</span>
                    <span className="font-semibold">{req.weeklyHours > req.hours ? `${req.weeklyHours} Std.` : `${req.hours} Std.`} <span className="font-normal text-xs text-slate-500">(ab {req.startHour}.)</span></span>
                  </div>
                  {req.weeklyHours > req.hours && (
                    <div className="text-xs font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-1.5 rounded-md mb-2 flex items-center justify-between">
                      <span>Bereits abgedeckt:</span>
                      <span className="font-bold">{req.assignments?.filter((a: AssignmentData) => a.status !== 'REJECTED').reduce((sum: number, a: AssignmentData) => sum + a.hours, 0) || 0} / {req.weeklyHours} Std.</span>
                    </div>
                  )}
                  {req.assignments && req.assignments.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {req.assignments.map((assign: AssignmentData) => {
                        const d = new Date(assign.date);
                        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                        return (
                          <div key={assign.id} className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center justify-between gap-1 w-full bg-emerald-50 dark:bg-emerald-900/20 p-1.5 rounded">
                            <div className="flex-1">👤 {assign.teacher?.name} ({dayName}, {d.toLocaleDateString('de-DE')} - {assign.hours}h)
                              <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] uppercase ${assign.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : assign.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{assign.status === 'PENDING' ? 'Wartet' : assign.status === 'ACCEPTED' ? 'Bestätigt' : 'Abgelehnt'}</span>
                            </div>
                            <DeleteAssignmentButton assignId={assign.id} isDeleting={isDeleting} setIsDeleting={setIsDeleting} loadData={loadData} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-col gap-1 mt-2">
                    <div className="text-xs inline-flex px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-md text-slate-500 font-medium w-fit">Quals: {req.qualifications || 'Beliebig'}</div>
                    {req.comments && (
                      <Popover>
                        <PopoverTrigger>
                          <div className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-1.5 rounded-md mt-1 flex items-start gap-1.5 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
                            <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span className="line-clamp-2">{req.comments}</span>
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 text-sm">
                          <p className="font-semibold mb-1 text-slate-700 dark:text-slate-300">Kommentar</p>
                          <p className="whitespace-pre-wrap leading-relaxed text-slate-600 dark:text-slate-400">{req.comments}</p>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* CANDIDATES LIST */}
          {activeRequest && (
            <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-6 animate-in fade-in slide-in-from-top-4">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                Top Kandidaten für {activeRequest.school.name}
              </h3>
              
              {candidates.length === 0 ? (
                <div className="p-4 bg-red-50 text-red-800 rounded-xl border border-red-100 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300">
                  Keine verfügbaren Kandidaten gefunden (Stundenlimit erreicht oder ungeplanter Ausfall).
                </div>
              ) : (
                <div className="space-y-4">
                  {candidates.slice(0, 5).map((candidate) => {
                    return (
                      <div 
                        key={candidate.id} 
                        className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl bg-white/70 dark:bg-slate-900/50 backdrop-blur-sm hover:bg-white dark:hover:bg-slate-900 shadow-sm hover:shadow-md hover:scale-[1.01] hover:border-primary/20 dark:hover:border-primary/20 transition-all duration-300 gap-4"
                      >
                        <div className="flex items-center gap-4 w-full sm:w-auto">
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-2">
                              <div className="font-bold text-lg text-slate-800 dark:text-slate-100">{candidate.name}</div>
                              <div className="text-right">
                                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                                  {(candidate.matchScore || 0).toFixed(0)} Pkt
                                </Badge>
                                <div className="text-[10px] text-slate-400 mt-1">{(candidate.distanceToSchool || 0).toFixed(1)} km entfernt</div>
                              </div>
                            </div>

                            <div className="text-sm text-slate-500 dark:text-slate-400 mt-2 flex flex-wrap gap-2.5 items-center">
                              <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300">
                                <div className="text-slate-400 flex items-center gap-1">
                                  <Navigation className="h-3 w-3" /> {(candidate.distanceToSchool || 0).toFixed(1)} km
                                </div>
                              </span>
                              <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300">
                                <Clock className="h-3.5 w-3.5 text-chart-2 shrink-0" />
                                {candidate.assignedHours}/{candidate.maxWeeklyHours}h
                              </span>
                              <span className="text-[11px] bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-lg text-slate-500 dark:text-slate-400 font-medium">
                                {candidate.qualifications}
                              </span>
                            </div>
                          </div>
                        </div>

                        <Button 
                          onClick={() => openAssignModal(candidate)}
                          className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md hover:shadow-primary/20 transition-all active:scale-95 rounded-xl px-5 h-10 shrink-0"
                        >
                          Zuweisen
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* ERFOLGREICH ZUGEWIESENE BEDARFE (FILLED) */}
      <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 mt-6 transition-all opacity-80 hover:opacity-100">
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <CardTitle className="text-xl text-emerald-700 dark:text-emerald-500 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            Letzte erfolgreich zugewiesene Bedarfe (max. 30)
          </CardTitle>
          <CardDescription>Diese Bedarfe sind vollständig abgedeckt. Klicken Sie auf eine Anfrage, um die Zuweisungen zu verwalten oder zu stornieren.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredRequests.filter(r => r.status === 'FILLED').length === 0 ? (
              <p className="text-slate-500 italic py-4 col-span-full">Keine abgeschlossenen Anfragen vorhanden.</p>
            ) : (
              [...filteredRequests]
                .filter(r => r.status === 'FILLED')
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, 30)
                .map(req => (
                <div 
                  key={req.id} 
                  onClick={() => handleMatch(req)}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col justify-between h-full bg-slate-50 border-slate-200 hover:shadow-md dark:bg-slate-900/50 dark:border-slate-700 ${
                    activeRequest?.id === req.id ? 'ring-2 ring-emerald-500 shadow-md bg-emerald-50/50 dark:bg-emerald-900/20 border-emerald-300' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex flex-col">
                      <span className="font-bold text-lg leading-tight">{req.school.name}</span>
                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full w-max mt-1 border border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-400">
                        VOLLSTÄNDIG
                      </span>
                    </div>
                    <div className="bg-slate-200 text-slate-700 font-bold px-3 py-1 rounded-full text-sm shrink-0 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                      {req.weeklyHours}h
                    </div>
                  </div>
                  
                  <div className="space-y-1 mt-auto">
                    <div className="flex items-center text-sm text-slate-600 dark:text-slate-400 font-medium">
                      <Calendar className="w-4 h-4 mr-2 text-emerald-500" />
                      {new Date(req.date).toLocaleDateString('de-DE')} 
                      {req.endDate && ` - ${new Date(req.endDate).toLocaleDateString('de-DE')}`}
                    </div>
                    {req.assignments && req.assignments.length > 0 && (
                      <div className="mb-2 space-y-1 mt-3 border-t border-slate-200 dark:border-slate-700 pt-2">
                        {req.assignments.map((assign: AssignmentData) => {
                          const d = new Date(assign.date);
                          const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                          return (
                            <div key={assign.id} className="text-[11px] font-medium text-slate-700 dark:text-slate-400 flex items-center justify-between gap-1 w-full bg-slate-100 dark:bg-slate-800 p-1.5 rounded">
                              <div className="flex-1 truncate">👤 <span className="font-semibold">{assign.teacher?.name}</span> ({dayName}, {d.toLocaleDateString('de-DE')} - {assign.hours}h)
                                <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] uppercase ${assign.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : assign.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{assign.status === 'PENDING' ? 'Wartet' : assign.status === 'ACCEPTED' ? 'Bestätigt' : 'Abgelehnt'}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(`/api/assignments/${assign.id}/pdf`, '_blank');
                                  }}
                                  className="text-indigo-650 hover:text-indigo-850 dark:text-indigo-400 dark:hover:text-indigo-300 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 px-1.5 py-0.5 rounded transition-colors flex items-center gap-0.5"
                                  title="Abordnungsschreiben (PDF) herunterladen"
                                >
                                  <FileDown className="h-3 w-3" /> PDF
                                </button>
                                <DeleteAssignmentButton assignId={assign.id} isDeleting={isDeleting} setIsDeleting={setIsDeleting} loadData={loadData} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
