import { useMemo, useState } from "react";
import { RequestData, AssignmentData } from "@/types/models";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar, Trash2, MessageSquare, HeartPulse, GraduationCap, Building, Archive, ChevronDown, ChevronRight, Users, CheckCircle2 } from "lucide-react";

/**
 * Liegt das Ende der Anfrage (bzw. ihr einziger Tag) vor dem heutigen Tag?
 * Vergangene Anfragen wandern ins eingeklappte Archiv, damit die Liste
 * tatsächlich nur „Aktive & Ausstehende" zeigt.
 *
 * Eine laufende offene Anfrage (isOpenEnded, kein endDate) hat kein Enddatum,
 * an dem sie „vorbei" wäre – sie bleibt aktiv, bis die Rückkehr gemeldet wird,
 * auch wenn der gemeldete Starttag längst vergangen ist.
 */
function isPastRequest(req: RequestData, today: Date): boolean {
  if (req.isOpenEnded && !req.endDate) return false;
  const end = new Date(req.endDate || req.date);
  end.setHours(0, 0, 0, 0);
  return end < today;
}

const STATUS_FILTERS = [
  { id: 'PENDING', label: 'Ausstehend', activeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40' },
  { id: 'PARTIALLY_FILLED', label: 'Teilweise', activeClass: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40' },
  { id: 'FILLED', label: 'Besetzt', activeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40' },
  { id: 'UNFILLED', label: 'Keine Reserve', activeClass: 'bg-slate-200 text-red-800 border-slate-300 dark:bg-slate-500/20 dark:text-red-300 dark:border-slate-500/40' },
] as const;

/**
 * Kompakte Darstellung der Zuweisungen: eine Zeile statt einer Box pro Einsatz.
 * Details (Einsatztage, Qualifikation, Kontakt) öffnen sich per Klick – so bleibt
 * eine mehrwöchige Vertretung mit vielen Einsatztagen eine flache Tabellenzeile.
 */
function AssignmentSummary({ assignments }: { assignments: AssignmentData[] }) {
  const active = assignments.filter(a => a.status !== 'REJECTED');
  if (active.length === 0) return null;

  // Einsätze je Lehrkraft bündeln – meist ist es eine, bei Aufteilung mehrere.
  const byTeacher = new Map<string, { teacher: AssignmentData['teacher']; entries: AssignmentData[] }>();
  for (const a of active) {
    const key = a.teacher?.id ?? a.teacherId;
    if (!byTeacher.has(key)) byTeacher.set(key, { teacher: a.teacher, entries: [] });
    byTeacher.get(key)!.entries.push(a);
  }
  const teacherNames = Array.from(byTeacher.values()).map(t => t.teacher?.name || 'Unbekannt');
  // Bei mehreren Lehrkräften nur die Anzahl – die Namen sprengen sonst die Spalte
  // und stehen ohnehin vollständig im Popover.
  const label = teacherNames.length === 1 ? teacherNames[0] : `${teacherNames.length} Lehrkräfte`;

  return (
    <Popover>
      <PopoverTrigger>
        {/* Die Namen sind eng begrenzt, damit die Zeile die Tabellenspalte nicht
            aufbläht – der vollständige Stand steht ohnehin im Popover. */}
        <div
          title={`${teacherNames.join(', ')} – ${active.length} Einsatztage`}
          className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/30 px-2 py-1 rounded-md flex items-center gap-1.5 cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors w-fit"
        >
          <Users className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[8rem]">{label}</span>
          <span className="text-emerald-600/80 dark:text-emerald-500/80 whitespace-nowrap shrink-0">
            · {active.length} {active.length === 1 ? 'Tag' : 'Tage'}
          </span>
          <ChevronRight className="w-3 h-3 shrink-0" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[90vw] text-sm max-h-80 overflow-y-auto">
        {Array.from(byTeacher.values()).map(({ teacher, entries }, i) => (
          <div key={teacher?.id ?? i} className={i > 0 ? 'mt-3 pt-3 border-t border-border' : ''}>
            <p className="font-semibold text-foreground">{teacher?.name || 'Unbekannt'}</p>
            {/* Qualifikation der zugewiesenen Person: Erst hier ist sie für die Schule
                relevant – daran erkennt sie, womit sie planen kann (z.B. Drittkraft
                statt voll ausgebildeter Lehrkraft). */}
            {teacher?.qualifications && (
              <div className="mt-1 flex flex-wrap gap-1">
                {teacher.qualifications.split(',').filter(Boolean).map(q => (
                  <span key={q} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
                    {q.trim()}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">
              📞 {teacher?.phone || 'Keine Nummer'} &nbsp;|&nbsp; ✉️ {teacher?.email || 'Keine Mail'}
            </p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              {entries
                .slice()
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map(a => {
                  const d = new Date(a.date);
                  const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                  return `${dayName} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} (${a.hours}h)`;
                })
                .join(', ')}
            </p>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function statusBadge(req: RequestData, isArchive: boolean) {
  // Im Archiv ist „ausstehend" irreführend – der Tag ist vorbei, die Anfrage
  // wurde schlicht nie besetzt. UNFILLED ist ein eigener Status und läuft hier
  // nicht mit rein, sonst würde die aktive Entscheidung des Schulamts wie ein
  // simples Verstreichen der Frist aussehen.
  if (isArchive && req.status === 'PENDING') {
    return <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">NICHT BESETZT</span>;
  }
  const cls = req.status === 'PENDING'
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30'
    : req.status === 'PARTIALLY_FILLED'
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30'
      : req.status === 'FILLED'
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30'
        : req.status === 'UNFILLED'
          // Deutlich negativ, aber nicht alarmierend rot wie ein Fehlerzustand –
          // das Schulamt hat aktiv entschieden, es ist kein Systemfehler.
          ? 'bg-slate-200 text-red-800 dark:bg-slate-500/20 dark:text-red-300 border border-slate-300 dark:border-slate-500/40'
          : 'bg-muted text-muted-foreground';
  const label = req.status === 'PENDING' ? 'AUSSTEHEND' : req.status === 'PARTIALLY_FILLED' ? 'TEILWEISE' : req.status === 'FILLED' ? 'BESETZT' : req.status === 'UNFILLED' ? 'KEINE RESERVE' : req.status;
  return <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold shadow-sm ${cls}`}>{label}</span>;
}

/**
 * Begründung für UNFILLED: mit Text als Popover (wie bei AssignmentSummary),
 * ohne Text als schlichter Hinweis – „kein Grund" ist selbst eine Information,
 * die die Schule nicht rätseln lassen darf, ob der Grund nur fehlt anzuzeigen.
 */
function UnfilledReason({ req }: { req: RequestData }) {
  if (!req.unfilledReason) {
    return <p className="mt-1 text-xs text-muted-foreground italic">Ohne Begründung</p>;
  }
  return (
    <Popover>
      <PopoverTrigger>
        <div
          title={req.unfilledReason}
          className="mt-1 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 px-2 py-1 rounded-md flex items-center gap-1.5 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors w-fit"
        >
          <MessageSquare className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[8rem]">{req.unfilledReason}</span>
          <ChevronRight className="w-3 h-3 shrink-0" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[90vw] text-sm">
        <p className="text-foreground leading-relaxed">{req.unfilledReason}</p>
        {req.unfilledAt && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Entschieden am {new Date(req.unfilledAt).toLocaleDateString('de-DE')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Die eigentliche Tabelle – identisch für aktive Gruppen und das Archiv. */
function RequestsTable({ rows, handleCancel, handleEndRequest, isArchive = false }: {
  rows: RequestData[];
  handleCancel: (id: string) => void;
  handleEndRequest: (req: RequestData) => void;
  isArchive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="font-semibold text-foreground">Datum</TableHead>
              <TableHead className="font-semibold text-foreground">Klasse</TableHead>
              <TableHead className="font-semibold text-foreground">Zeitraum</TableHead>
              <TableHead className="font-semibold text-foreground">Schulart</TableHead>
              <TableHead className="font-semibold text-foreground">Status / Zuweisung</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Aktion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((req) => (
              <TableRow key={req.id} className="group hover:bg-muted/80 transition-colors">
                <TableCell className="font-medium text-foreground">
                  {req.isOpenEnded && !req.endDate ? (
                    // Laufende offene Anfrage: kein Enddatum, „läuft" macht das deutlich.
                    // Als eigene Zeile statt in Klammern dahinter – sonst wird die
                    // Datumsspalte so breit, dass die Aktion-Spalte aus der Karte fällt.
                    <>
                      ab {new Date(req.date).toLocaleDateString('de-DE')}
                      <span className="block text-xs font-normal text-sky-700 dark:text-sky-400">läuft</span>
                    </>
                  ) : (
                    <>
                      {new Date(req.date).toLocaleDateString('de-DE')}
                      {req.endDate && ` - ${new Date(req.endDate).toLocaleDateString('de-DE')}`}
                      {req.endedAt && (
                        <div className="text-xs font-normal text-muted-foreground mt-0.5">
                          beendet am {new Date(req.endedAt).toLocaleDateString('de-DE')}
                        </div>
                      )}
                    </>
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{req.schoolType === 'GRUNDSCHULE' ? 'GS' : req.schoolType === 'MITTELSCHULE' ? 'MS' : 'GS/MS'}</div>
                  <div className="text-xs text-muted-foreground">Für: {req.substitutedTeacher || '-'}</div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{req.schedule ? 'Individueller Plan' : (req.weeklyHours > req.hours ? `${req.weeklyHours} Std. gesamt` : `${req.hours} Std.`)}</div>
                  <div className="text-xs text-muted-foreground">{req.schedule ? `${req.weeklyHours} Std./Woche` : `ab ${req.startHour}. Std (${req.hours}h/Tag)`}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm text-foreground">{req.qualifications || 'Beliebig'}</div>
                  {req.comments && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1" title={req.comments}>
                      <MessageSquare className="w-3 h-3" /> Info hinterlegt
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start">
                    {statusBadge(req, isArchive)}
                    {req.status === 'UNFILLED' && <UnfilledReason req={req} />}
                    {req.assignments && <AssignmentSummary assignments={req.assignments} />}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Laufende offene Anfrage: Rückkehr melden schließt sie mit
                        einem letzten Tag ab – unabhängig vom Besetzungsstatus. */}
                    {req.isOpenEnded && !req.endDate && !isArchive && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={() => handleEndRequest(req)}
                        aria-label="Rückkehr melden"
                        title="Rückkehr melden – beendet die Vertretung mit einem letzten Tag"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {/* Nur das Symbol: Die Beschriftung trieb die Aktion-Spalte über
                            den Kartenrand hinaus. Bedeutung über title und aria-label. */}
                      </Button>
                    )}
                    {/* UNFILLED ist bereits durch die Statusprüfung ausgeschlossen –
                        stornierbar ist nur, was noch PENDING ist. */}
                    {req.status === 'PENDING' && !isArchive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all rounded-full h-8 w-8 p-0 shrink-0"
                        onClick={() => handleCancel(req.id)}
                        aria-label="Anfrage stornieren"
                        title="Anfrage stornieren"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function SchoolRequestsList({
  requests,
  loading,
  handleCancel,
  handleEndRequest
}: {
  requests: RequestData[];
  loading: boolean;
  handleCancel: (id: string) => void;
  handleEndRequest: (req: RequestData) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);

  const categories = useMemo(() => [
    { id: 'UNPLANNED_ABSENCE', label: 'Ungeplanter Ausfall (Priorität 1)', icon: HeartPulse, color: 'rose' },
    { id: 'FORTBILDUNG', label: 'Fortbildung (Priorität 2)', icon: GraduationCap, color: 'blue' },
    { id: 'SCHULINTERN', label: 'Schulintern geblockt (Priorität 3)', icon: Building, color: 'slate' }
  ], []);

  // Vergangenes wandert ins Archiv – standardmäßig sieht die Schule nur, was
  // heute läuft oder noch bevorsteht.
  const { current, archived } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current: RequestData[] = [];
    const archived: RequestData[] = [];
    for (const req of requests) {
      (isPastRequest(req, today) ? archived : current).push(req);
    }
    archived.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { current, archived };
  }, [requests]);

  const toggleFilter = (id: string) =>
    setStatusFilter(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);

  const filteredCurrent = statusFilter.length === 0
    ? current
    : current.filter(r => statusFilter.includes(r.status));

  const requestsByCategory = useMemo(() => {
    const grouped: Record<string, RequestData[]> = {};
    for (const cat of categories) {
      grouped[cat.id] = filteredCurrent.filter(r => (r.priority || 'UNPLANNED_ABSENCE') === cat.id);
    }
    return grouped;
  }, [filteredCurrent, categories]);

  return (
    <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border h-full">
      <CardHeader>
        <CardTitle className="text-xl">Aktive & Ausstehende Anfragen</CardTitle>
        <CardDescription>Ihre laufenden und kommenden Bedarfe. Vergangenes finden Sie unten im Archiv.</CardDescription>
        {current.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2" role="group" aria-label="Nach Status filtern">
            {STATUS_FILTERS.map(f => {
              const isActive = statusFilter.includes(f.id);
              const count = current.filter(r => r.status === f.id).length;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => toggleFilter(f.id)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isActive ? f.activeClass : 'bg-card text-muted-foreground border-border hover:border-primary/40'
                  }`}
                >
                  {f.label} ({count})
                </button>
              );
            })}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-12 text-muted-foreground animate-pulse">Lade Anfragen...</div>
        ) : requests.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-muted/50 rounded-2xl border-2 border-dashed border-border">
            <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium text-muted-foreground">Keine aktiven Anfragen gefunden.</p>
            <p className="text-sm mt-1">Erstellen Sie eine neue Anfrage auf der linken Seite.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {filteredCurrent.length === 0 && (
              <p className="text-muted-foreground italic py-4">
                {statusFilter.length > 0
                  ? 'Keine Anfragen mit dem gewählten Status.'
                  : 'Keine laufenden oder kommenden Anfragen.'}
              </p>
            )}
            {categories.map(category => {
              const categoryRequests = requestsByCategory[category.id] || [];
              if (categoryRequests.length === 0) return null;
              const Icon = category.icon;
              const colorClasses: Record<string, string> = {
                rose: 'text-rose-700 dark:text-rose-400',
                blue: 'text-blue-700 dark:text-blue-400',
                slate: 'text-muted-foreground'
              };
              return (
                <div key={category.id} className="space-y-3">
                  <h3 className={`font-semibold flex items-center gap-2 ${colorClasses[category.color]}`}>
                    <Icon className="w-5 h-5" /> {category.label}
                  </h3>
                  <RequestsTable rows={categoryRequests} handleCancel={handleCancel} handleEndRequest={handleEndRequest} />
                </div>
              );
            })}

            {archived.length > 0 && (
              <div className="pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsArchiveOpen(o => !o)}
                  aria-expanded={isArchiveOpen}
                  className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
                >
                  {isArchiveOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <Archive className="w-4 h-4" />
                  Archiv ({archived.length} vergangene {archived.length === 1 ? 'Anfrage' : 'Anfragen'})
                </button>
                {isArchiveOpen && (
                  <div className="mt-3">
                    <RequestsTable rows={archived} handleCancel={handleCancel} handleEndRequest={handleEndRequest} isArchive />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
