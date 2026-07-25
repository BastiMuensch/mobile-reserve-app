import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, AlertCircle, CheckCircle2, Activity, FileDown } from "lucide-react";
import { TeacherData, RequestData } from "@/types/models";

interface KpiDetailDialogProps {
  activeKpiDetail: 'reserven' | 'offene' | 'besetzte' | 'unavailable' | null;
  setActiveKpiDetail: (val: 'reserven' | 'offene' | 'besetzte' | 'unavailable' | null) => void;
  teachers: TeacherData[];
  openRequests: RequestData[];
  filledRequests: RequestData[];
  sickTeachers: TeacherData[];
  openRequestCount: number;
  filledRequestCount: number;
  sickTeacherCount: number;
  handleSelectRequestFromKpi: (req: RequestData) => void;
}

export function KpiDetailDialog({
  activeKpiDetail,
  setActiveKpiDetail,
  teachers,
  openRequests,
  filledRequests,
  sickTeachers,
  openRequestCount,
  filledRequestCount,
  sickTeacherCount,
  handleSelectRequestFromKpi
}: KpiDetailDialogProps) {
  return (
    <Dialog open={activeKpiDetail !== null} onOpenChange={(open) => !open && setActiveKpiDetail(null)}>
      <DialogContent className="w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[80vw] xl:max-w-[75vw] max-h-[90vh] overflow-y-auto rounded-2xl bg-popover/95 backdrop-blur-md border border-border/80 shadow-2xl p-6">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-2xl font-bold flex items-center gap-3 text-foreground">
            {activeKpiDetail === 'reserven' && (
              <>
                <div className="p-2 bg-primary/10 text-primary rounded-xl">
                  <Users className="h-6 w-6" />
                </div>
                Mobile Reserven Übersicht ({teachers.length})
              </>
            )}
            {activeKpiDetail === 'offene' && (
              <>
                <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
                  <AlertCircle className="h-6 w-6" />
                </div>
                Offene Bedarfe ({openRequestCount})
              </>
            )}
            {activeKpiDetail === 'besetzte' && (
              <>
                <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                Besetzte Bedarfe ({filledRequestCount})
              </>
            )}
            {activeKpiDetail === 'unavailable' && (
              <>
                <div className="p-2 bg-rose-500/10 text-rose-500 rounded-xl">
                  <Activity className="h-6 w-6" />
                </div>
                Ungeplante Ausfälle ({sickTeacherCount})
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-2">
            {activeKpiDetail === 'reserven' && "Auflistung aller registrierten mobilen Reserven für das aktive Schuljahr und deren aktuellen Bereitschaftsstatus."}
            {activeKpiDetail === 'offene' && "Hier sehen Sie alle offenen oder teilweise besetzten Bedarfe der Schulen, für die Vertretungslehrkräfte gesucht werden."}
            {activeKpiDetail === 'besetzte' && "Übersicht über alle erfolgreich vermittelten und besetzten Bedarfe."}
            {activeKpiDetail === 'unavailable' && "Auflistung aller aktuell ungeplant ausgefallenen Lehrkräfte, die vorübergehend nicht zur Verfügung stehen."}
          </DialogDescription>
        </DialogHeader>

        <div className="py-6">
          {activeKpiDetail === 'reserven' && (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="font-semibold">Name</TableHead>
                      <TableHead className="font-semibold">Stammschule</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold text-right">Fächer / Qualifikationen</TableHead>
                      <TableHead className="font-semibold text-right">Max. Stunden</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teachers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6 italic">
                          Keine Lehrkräfte vorhanden
                        </TableCell>
                      </TableRow>
                    ) : (
                      teachers.map((teacher) => (
                        <TableRow key={teacher.id} className="hover:bg-muted/50">
                          <TableCell className="font-bold text-foreground">
                            {teacher.name}
                            {teacher.isAbsentToday && (
                              <Badge className="ml-2 bg-rose-500/10 text-rose-600 border border-rose-500/20 dark:bg-rose-950/30 align-middle">Heute abwesend</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{teacher.stammschule?.name || "Keine Stammschule"}</TableCell>
                          <TableCell>
                            <Badge className={
                              teacher.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:bg-emerald-950/30' :
                              teacher.status === 'UNAVAILABLE' ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20 dark:bg-rose-950/30' :
                              'bg-muted text-muted-foreground border border-border'
                            }>
                              {teacher.status === 'ACTIVE' ? 'Aktiv' : teacher.status === 'UNAVAILABLE' ? 'Ausfall' : 'Beurlaubt'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono text-muted-foreground">{teacher.qualifications}</TableCell>
                          <TableCell className="text-right font-medium text-foreground">{teacher.maxWeeklyHours} Std.</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {activeKpiDetail === 'offene' && (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="font-semibold">Schule</TableHead>
                      <TableHead className="font-semibold">Datum / Zeitraum</TableHead>
                      <TableHead className="font-semibold">Bedarfsstunden</TableHead>
                      <TableHead className="font-semibold">Priorität</TableHead>
                      <TableHead className="font-semibold">Qualifikation</TableHead>
                      <TableHead className="font-semibold text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openRequests.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6 italic">
                          Keine offenen Bedarfe vorhanden
                        </TableCell>
                      </TableRow>
                    ) : (
                      openRequests.map((req) => {
                        const d = new Date(req.date);
                        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                        return (
                          <TableRow
                            key={req.id}
                            onClick={() => handleSelectRequestFromKpi(req)}
                            className="hover:bg-muted/60 cursor-pointer transition-colors"
                            title="Klicken, um diesen Bedarf im Matching-System auszuwählen"
                          >
                            <TableCell className="font-bold text-foreground">{req.school?.name}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {dayName}, {d.toLocaleDateString('de-DE')} {req.endDate ? ` bis ${new Date(req.endDate).toLocaleDateString('de-DE')}` : ''}
                            </TableCell>
                            <TableCell className="font-medium text-foreground">
                              {req.weeklyHours > req.hours ? `${req.weeklyHours} Std. gesamt (${req.hours} Std./Tag)` : `${req.hours} Std.`}
                            </TableCell>
                            <TableCell>
                              <Badge className={
                                req.priority === 'UNPLANNED_ABSENCE' ? 'bg-red-500/10 text-red-600 border border-red-500/20 dark:bg-red-950/30' :
                                req.priority === 'FORTBILDUNG' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-950/30' :
                                'bg-muted text-muted-foreground border border-border'
                              }>
                                {req.priority}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{req.qualifications}</TableCell>
                            <TableCell className="text-right">
                              <Badge className={
                                req.status === 'PARTIALLY_FILLED' ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20 dark:bg-blue-950/30' :
                                'bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-950/30'
                              }>
                                {req.status === 'PARTIALLY_FILLED' ? 'Teilweise besetzt' : 'Aktion nötig'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {activeKpiDetail === 'besetzte' && (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="font-semibold">Schule</TableHead>
                      <TableHead className="font-semibold">Datum / Tag</TableHead>
                      <TableHead className="font-semibold">Stunden</TableHead>
                      <TableHead className="font-semibold text-right">Zugeordnete Vertretung</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filledRequests.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-6 italic">
                          Keine besetzten Bedarfe vorhanden
                        </TableCell>
                      </TableRow>
                    ) : (
                      filledRequests.map((req) => {
                        const d = new Date(req.date);
                        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                        return (
                          <TableRow
                            key={req.id}
                            onClick={() => handleSelectRequestFromKpi(req)}
                            className="hover:bg-muted/60 cursor-pointer transition-colors"
                            title="Klicken, um diesen Bedarf im Matching-System auszuwählen"
                          >
                            <TableCell className="font-bold text-foreground">{req.school?.name}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {dayName}, {d.toLocaleDateString('de-DE')}
                            </TableCell>
                            <TableCell className="font-medium text-foreground">
                              {req.weeklyHours > req.hours ? `${req.weeklyHours} Std.` : `${req.hours} Std.`}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end gap-1">
                                {req.assignments && req.assignments.length > 0 ? (
                                  req.assignments.map(a => (
                                    <div key={a.id} className="flex items-center gap-1.5 justify-end">
                                      <Badge className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:bg-emerald-950/30 flex items-center gap-1 w-fit">
                                        <span>👤 {a.teacher?.name || 'Lehrkraft'} ({a.hours}h)</span>
                                      </Badge>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.open(`/api/assignments/${a.id}/pdf`, '_blank');
                                        }}
                                        className="p-1 hover:bg-muted text-muted-foreground hover:text-primary rounded transition-colors"
                                        aria-label={`Abordnungsschreiben für ${a.teacher?.name || 'Lehrkraft'} als PDF herunterladen`}
                                        title="Abordnungsschreiben (PDF) herunterladen"
                                      >
                                        <FileDown className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">Keine Zuweisung</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {activeKpiDetail === 'unavailable' && (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="font-semibold">Name</TableHead>
                      <TableHead className="font-semibold">Stammschule</TableHead>
                      <TableHead className="font-semibold">E-Mail</TableHead>
                      <TableHead className="font-semibold text-right">Telefon</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sickTeachers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-emerald-600 dark:text-emerald-400 font-bold py-8">
                          🎉 Aktuell gibt es keine ungeplanten Ausfälle!
                        </TableCell>
                      </TableRow>
                    ) : (
                      sickTeachers.map((teacher) => (
                        <TableRow key={teacher.id} className="hover:bg-muted/50">
                          <TableCell className="font-bold text-rose-600 dark:text-rose-400">{teacher.name}</TableCell>
                          <TableCell className="text-muted-foreground">{teacher.stammschule?.name || "Keine Stammschule"}</TableCell>
                          <TableCell className="text-muted-foreground">{teacher.email || "-"}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{teacher.phone || "-"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-4">
          <Button variant="outline" onClick={() => setActiveKpiDetail(null)} className="rounded-xl shadow-sm">
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
