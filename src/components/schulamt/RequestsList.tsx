import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { CheckCircle2, Clock, Navigation, Calendar, FileDown, MessageSquare, AlertTriangle, CalendarClock, ChevronDown, ChevronRight, Flame, School, Ban, RotateCcw, Wand2 } from "lucide-react";
import { requestUrgencyScore, urgencyReasons, isSchoolInOutbreak } from "@/lib/urgency";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { RequestData, TeacherData, AssignmentData } from "@/types/models";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

const ASSIGNMENT_STATUS_BADGE_CLASSES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  ACCEPTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

function assignmentStatusBadgeClass(status: string) {
  return ASSIGNMENT_STATUS_BADGE_CLASSES[status] ?? ASSIGNMENT_STATUS_BADGE_CLASSES.REJECTED;
}

// Lehrkräfte können einen Einsatz nur bestätigen. REJECTED entsteht deshalb nicht mehr
// durch eine Ablehnung, sondern ausschließlich, wenn eine Lehrkraft für den Tag einen
// Ausfall gemeldet hat – das Label benennt genau das.
function assignmentStatusLabel(status: string) {
  if (status === 'ACCEPTED') return 'Bestätigt';
  if (status === 'PENDING') return 'Nicht bestätigt';
  return 'Storniert (Ausfall)';
}

/**
 * Tastaturbedienung für die klickbaren Bedarfs-Karten. Die Karten bleiben `div`s statt
 * `button`s, weil sie ihrerseits Buttons enthalten (Stornieren, PDF) – verschachtelte
 * `button`-Elemente wären ungültiges HTML. Auslösen nur, wenn das Ereignis von der Karte
 * selbst stammt: Enter auf einem inneren Button darf nicht zusätzlich die Karte öffnen.
 */
function handleCardKeyDown(action: () => void) {
  return (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
  };
}

/**
 * Zeigt auf einen Blick, ob die zugewiesenen Lehrkräfte ihren Einsatz bereits bestätigt
 * haben. Stornierte Zuweisungen (Ausfallmeldung) zählen nicht mit, da sie ohnehin neu
 * besetzt werden müssen.
 */
function ConfirmationSummary({ assignments }: { assignments: AssignmentData[] }) {
  const active = assignments.filter(a => a.status !== 'REJECTED');
  if (active.length === 0) return null;

  const confirmed = active.filter(a => a.status === 'ACCEPTED').length;
  const allConfirmed = confirmed === active.length;

  return (
    <div
      className={`text-xs font-medium px-2 py-1.5 rounded-md mb-2 flex items-center justify-between gap-2 ${
        allConfirmed
          ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'text-amber-800 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300'
      }`}
    >
      <span className="flex items-center gap-1.5">
        {allConfirmed
          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          : <Clock className="h-3.5 w-3.5 shrink-0" />}
        {allConfirmed ? 'Von allen bestätigt' : 'Bestätigung ausstehend'}
      </span>
      <span className="font-bold whitespace-nowrap">{confirmed} / {active.length}</span>
    </div>
  );
}

/** Reusable button to revoke a single assignment with confirmation & error handling */
function DeleteAssignmentButton({ assignId, isDeleting, setIsDeleting, loadData }: {
  assignId: string; isDeleting: boolean; setIsDeleting: (v: boolean) => void; loadData: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();

  return (
    <button
      disabled={isDeleting}
      onClick={async (e) => {
        e.stopPropagation();
        if (isDeleting) return;
        const confirmed = await confirm({
          title: "Zuweisung aufheben?",
          description: "Möchten Sie diese Zuweisung wirklich aufheben? Die Lehrkraft wird benachrichtigt.",
          confirmLabel: "Aufheben",
          variant: "destructive"
        });
        if (!confirmed) return;
        setIsDeleting(true);
        try {
          const res = await fetch(`/api/assignments/${assignId}`, { method: 'DELETE' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            toast({ variant: "error", title: `Fehler beim Aufheben: ${err.error || 'Unbekannter Fehler'}` });
            return;
          }
          loadData();
        } catch (error) {
          console.error('Delete assignment error:', error);
          toast({ variant: "error", title: "Netzwerkfehler beim Aufheben der Zuweisung." });
        } finally {
          setIsDeleting(false);
        }
      }}
      className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 bg-red-50 hover:bg-red-100 dark:bg-red-500/15 dark:hover:bg-red-500/25 px-1.5 py-0.5 rounded transition-colors"
      title="Zuweisung aufheben"
    >
      Aufheben
    </button>
  );
}

/**
 * Sortiert offene Anfragen nach Dringlichkeit: Überfällig (Ende liegt in der
 * Vergangenheit, nie besetzt), Heute & laufend, Diese Woche, Später. So sieht das
 * Schulamt auch bei vielen gleichzeitig offenen Anfragen sofort, wo es brennt.
 */
const URGENCY_GROUPS = [
  { id: 'overdue', label: 'Überfällig', icon: AlertTriangle, headClass: 'text-rose-700 dark:text-rose-400' },
  { id: 'today', label: 'Heute & laufend', icon: Clock, headClass: 'text-amber-700 dark:text-amber-400' },
  { id: 'week', label: 'Diese Woche', icon: Calendar, headClass: 'text-blue-700 dark:text-blue-400' },
  { id: 'later', label: 'Später', icon: CalendarClock, headClass: 'text-muted-foreground' },
] as const;

function groupByUrgency(requests: RequestData[]): Record<string, RequestData[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Sonntag der laufenden Woche (Wochenrechnung Mo–So wie in src/lib/matching.ts)
  const day = today.getDay();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() + (day === 0 ? 0 : 7 - day));

  const groups: Record<string, RequestData[]> = { overdue: [], today: [], week: [], later: [] };
  for (const req of requests) {
    const start = new Date(req.date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(req.endDate || req.date);
    end.setHours(0, 0, 0, 0);

    // Ein Bedarf "bis auf Weiteres" läuft noch – er ist nicht überfällig, auch wenn sein
    // Starttag längst vergangen ist. Sonst stünde jede andauernde Krankmeldung dauerhaft
    // unter "Überfällig" und verdrängte dort die echten Rückstände.
    if (req.isOpenEnded && !req.endDate) groups.today.push(req);
    else if (end < today) groups.overdue.push(req);
    else if (start <= today) groups.today.push(req);
    else if (start <= sunday) groups.week.push(req);
    else groups.later.push(req);
  }
  return groups;
}

/** Namen der tatsächlich eingeplanten Lehrkräfte für die kompakte Zeile. */
function teacherSummary(assignments: AssignmentData[] = []): string {
  const names = Array.from(new Set(
    assignments.filter(a => a.status !== 'REJECTED').map(a => a.teacher?.name).filter(Boolean)
  )) as string[];
  return names.join(', ');
}

/**
 * Die Einsatz-Zeilen einer Anfrage. Identisch für offene und besetzte Bedarfe – nur
 * besetzte bieten zusätzlich das Abordnungsschreiben als PDF an.
 */
function AssignmentRows({ assignments, isDeleting, setIsDeleting, loadData, showPdf = false }: {
  assignments: AssignmentData[];
  isDeleting: boolean;
  setIsDeleting: (v: boolean) => void;
  loadData: () => void;
  showPdf?: boolean;
}) {
  return (
    <div className="space-y-1">
      {assignments.map((assign) => {
        const d = new Date(assign.date);
        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
        return (
          <div key={assign.id} className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center justify-between gap-1 w-full bg-emerald-50 dark:bg-emerald-900/20 p-1.5 rounded">
            <div className="flex-1 min-w-0">
              👤 <span className="font-semibold">{assign.teacher?.name}</span> ({dayName}, {d.toLocaleDateString('de-DE')} - {assign.hours}h)
              <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] uppercase ${assignmentStatusBadgeClass(assign.status)}`}>{assignmentStatusLabel(assign.status)}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {showPdf && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(`/api/assignments/${assign.id}/pdf`, '_blank');
                  }}
                  className="text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 px-1.5 py-0.5 rounded transition-colors flex items-center gap-0.5"
                  title="Abordnungsschreiben (PDF) herunterladen"
                >
                  <FileDown className="h-3 w-3" /> PDF
                </button>
              )}
              <DeleteAssignmentButton assignId={assign.id} isDeleting={isDeleting} setIsDeleting={setIsDeleting} loadData={loadData} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Kleines Merkmal-Fähnchen an einer Anfragezeile (Kleine Schule, Häufung, ...). */
function UrgencyChip({ reason }: { reason: string }) {
  const style = reason === 'Häufung'
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
    : reason === 'Kleine Schule'
      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
      : 'bg-muted text-muted-foreground';
  const Icon = reason === 'Häufung' ? Flame : reason === 'Kleine Schule' ? School : null;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${style}`}>
      {Icon && <Icon className="w-2.5 h-2.5" />}{reason}
    </span>
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
  openManualAssignModal: () => void;
  isDeleting: boolean;
  setIsDeleting: (val: boolean) => void;
  loadData: () => void;
  /** Automatisch erkannte Häufungen: schoolId -> Tage (siehe src/lib/urgency.ts). */
  outbreakDays: Map<string, Set<string>>;
}

export function RequestsList({
  filteredRequests,
  searchRequestQuery,
  setSearchRequestQuery,
  activeRequest,
  handleMatch,
  candidates,
  openAssignModal,
  openManualAssignModal,
  isDeleting,
  setIsDeleting,
  loadData,
  outbreakDays
}: RequestsListProps) {
  const topCandidates = candidates.filter(c => !c.isOvertime).slice(0, 5);
  const overtimeCandidates = candidates.filter(c => c.isOvertime).slice(0, 5);

  const { toast } = useToast();
  const confirm = useConfirm();
  const [unfillingId, setUnfillingId] = useState<string | null>(null);

  const openRequests = filteredRequests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED');

  /** Merkmale und Punktwert einer Anfrage – Häufung kommt aus der Erkennung plus Übersteuerung. */
  const urgencyOf = (req: RequestData) => {
    const isOutbreak = isSchoolInOutbreak(req.school, outbreakDays, req);
    return {
      isOutbreak,
      score: requestUrgencyScore(req, req.school, { isOutbreak }),
      reasons: urgencyReasons(req, req.school, { isOutbreak }),
    };
  };

  // Innerhalb einer Dringlichkeitsgruppe zählt der Punktwert: eine kleine Schule mit
  // Häufung steht vor einer großen Schule mit einer einzelnen Lücke am selben Tag.
  const urgencyGroups = groupByUrgency(openRequests);
  for (const key of Object.keys(urgencyGroups)) {
    urgencyGroups[key].sort((a, b) => urgencyOf(b).score - urgencyOf(a).score);
  }

  const unfilledRequests = filteredRequests
    .filter(r => r.status === 'UNFILLED')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  /** Absage aussprechen: Begründung erfragen, dann Schule per E-Mail informieren lassen. */
  const markUnfilled = async (req: RequestData) => {
    const ok = await confirm({
      title: 'Keine Reserve verfügbar?',
      description: `Die Schule ${req.school.name} wird per E-Mail informiert, dass für den ${new Date(req.date).toLocaleDateString('de-DE')} keine Mobile Reserve gestellt werden kann. Die Absage lässt sich später zurücknehmen.`,
      confirmLabel: 'Absagen',
      variant: 'destructive',
    });
    if (!ok) return;

    setUnfillingId(req.id);
    try {
      const res = await fetch(`/api/requests/${req.id}/unfilled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ variant: 'error', title: err.error || 'Die Absage konnte nicht gespeichert werden.' });
        return;
      }
      toast({ variant: 'success', title: 'Absage gespeichert', description: 'Die Schule wurde informiert.' });
      loadData();
    } catch {
      toast({ variant: 'error', title: 'Netzwerkfehler. Bitte versuchen Sie es erneut.' });
    } finally {
      setUnfillingId(null);
    }
  };

  /**
   * Rückkehr melden – letzter Einsatztag ist heute. Das Schulamt trägt das ein, wenn die
   * Schule anruft statt es selbst zu melden; für ein abweichendes Datum ist die Schule
   * zuständig, die dafür ein Datumsfeld hat.
   */
  const endOpenRequest = async (req: RequestData) => {
    const heute = new Date();
    const ok = await confirm({
      title: 'Rückkehr melden?',
      description: `Die Vertretung an der Schule ${req.school.name} endet mit dem heutigen Tag (${heute.toLocaleDateString('de-DE')}). Geplante Einsätze danach werden storniert und die betroffenen Lehrkräfte informiert.`,
      confirmLabel: 'Rückkehr melden',
    });
    if (!ok) return;

    setUnfillingId(req.id);
    try {
      const res = await fetch(`/api/requests/${req.id}/end`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastDay: heute.toISOString().split('T')[0] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: 'error', title: body.error || 'Die Rückkehr konnte nicht gemeldet werden.' });
        return;
      }
      toast({
        variant: 'success',
        title: 'Rückkehr gemeldet',
        description: body.cancelledAssignments > 0
          ? `${body.cancelledAssignments} Einsätze nach heute wurden storniert.`
          : 'Es lagen keine Einsätze nach heute vor.',
      });
      loadData();
    } catch {
      toast({ variant: 'error', title: 'Netzwerkfehler. Bitte versuchen Sie es erneut.' });
    } finally {
      setUnfillingId(null);
    }
  };

  /** Absage zurücknehmen: die Anfrage ist danach wieder offen. */
  const revertUnfilled = async (req: RequestData) => {
    setUnfillingId(req.id);
    try {
      const res = await fetch(`/api/requests/${req.id}/unfilled`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ variant: 'error', title: err.error || 'Die Absage konnte nicht zurückgenommen werden.' });
        return;
      }
      toast({ variant: 'success', title: 'Absage zurückgenommen', description: 'Die Anfrage ist wieder offen.' });
      loadData();
    } catch {
      toast({ variant: 'error', title: 'Netzwerkfehler. Bitte versuchen Sie es erneut.' });
    } finally {
      setUnfillingId(null);
    }
  };

  const filledRequests = [...filteredRequests]
    .filter(r => r.status === 'FILLED')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 30);

  return (
    <>
      <Card id="matching-engine" className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60 transition-all">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl">Bedarfsübersicht & Matching Engine</CardTitle>
            <CardDescription>Wählen Sie eine ausstehende Anfrage, um die besten Kandidaten zu ermitteln.</CardDescription>
          </div>
          <Input
            placeholder="Suche (Schule, Grund)..."
            value={searchRequestQuery}
            onChange={e => setSearchRequestQuery(e.target.value)}
            className="w-64 bg-card/50 border-border/60 rounded-xl focus-visible:ring-primary focus-visible:border-primary"
          />
        </CardHeader>
        <CardContent>
          {/* Wer hier mehrere offene Bedarfe vor sich hat, will sie meist nicht einzeln
              durchklicken – der Hinweis führt genau dann zur Sammel-Besetzung. */}
          {openRequests.length > 1 && (
            <Link
              href="/schulamt/idealbesetzung"
              className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="flex items-center gap-2.5 text-sm">
                <Wand2 className="h-4 w-4 text-primary shrink-0" />
                <span className="text-foreground">
                  <strong className="font-semibold">{openRequests.length} offene Bedarfe.</strong>{' '}
                  <span className="text-muted-foreground">Die Idealbesetzung schlägt für alle auf einmal eine Verteilung vor.</span>
                </span>
              </span>
              <span className="text-sm font-medium text-primary whitespace-nowrap flex items-center gap-1">
                Öffnen <ChevronRight className="h-4 w-4" />
              </span>
            </Link>
          )}

          {openRequests.length === 0 ? (
            <p className="text-muted-foreground italic py-4">Keine ausstehenden Anfragen gefunden.</p>
          ) : (
            <div className="space-y-5">
              {URGENCY_GROUPS.map(group => {
                const groupRequests = urgencyGroups[group.id];
                if (groupRequests.length === 0) return null;
                const Icon = group.icon;
                return (
                  <div key={group.id} className="space-y-1.5">
                    <h3 className={`text-sm font-semibold flex items-center gap-1.5 ${group.headClass}`}>
                      <Icon className="w-4 h-4" /> {group.label}
                      <span className="font-normal text-xs text-muted-foreground">({groupRequests.length})</span>
                    </h3>
                    {groupRequests.map(req => {
                      const isActive = activeRequest?.id === req.id;
                      const covered = req.assignments?.filter((a: AssignmentData) => a.status !== 'REJECTED').reduce((sum: number, a: AssignmentData) => sum + a.hours, 0) || 0;
                      const total = req.weeklyHours > req.hours ? req.weeklyHours : req.hours;
                      // Nur die schulbezogenen Merkmale als Fähnchen – "Überfällig" und
                      // "Ungeplanter Ausfall" stehen schon in der Gruppenüberschrift bzw.
                      // in den Details und wären hier bloß Rauschen.
                      const chips = urgencyOf(req).reasons.filter(r => r === 'Kleine Schule' || r === 'Häufung');
                      return (
                        <div key={req.id}>
                          {/* Kompakte Zeile: alles Wesentliche auf einen Blick, Details erst im aufgeklappten Zustand */}
                          <div
                            role="button"
                            tabIndex={0}
                            aria-expanded={isActive}
                            aria-label={`Bedarf ${req.school.name} am ${new Date(req.date).toLocaleDateString('de-DE')} – passende Lehrkräfte suchen`}
                            onClick={() => handleMatch(req)}
                            onKeyDown={handleCardKeyDown(() => handleMatch(req))}
                            className={`px-3 py-2 rounded-xl border cursor-pointer transition-all flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                              isActive
                                ? 'border-primary bg-primary/5 ring-2 ring-primary/15'
                                : 'border-border hover:border-primary/40 bg-card shadow-sm'
                            } ${group.id === 'overdue' && !isActive ? 'border-rose-200 dark:border-rose-900/60' : ''}`}
                          >
                            {isActive ? <ChevronDown className="w-4 h-4 text-primary shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                            <span className="font-semibold text-sm text-foreground truncate">{req.school.name}</span>
                            {chips.map(reason => <UrgencyChip key={reason} reason={reason} />)}
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {req.isOpenEnded && !req.endDate ? 'ab ' : ''}
                              {new Date(req.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                              {req.endDate && `–${new Date(req.endDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`}
                            </span>
                            {req.isOpenEnded && !req.endDate && (
                              <Badge variant="secondary" className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 shrink-0" title="Krankmeldung ohne bekanntes Ende – läuft, bis die Schule die Rückkehr meldet">
                                läuft
                              </Badge>
                            )}
                            <span className={`text-xs font-medium whitespace-nowrap ml-auto ${covered > 0 ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground'}`}>
                              {covered}/{total} Std.
                            </span>
                            {req.status === 'PARTIALLY_FILLED' && <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 shrink-0">Teilweise</Badge>}
                            {req.comments && <MessageSquare className="w-3.5 h-3.5 text-blue-500 shrink-0" aria-label="Kommentar vorhanden" />}
                          </div>

                          {isActive && (
                            <div className="mt-1.5 ml-6 p-3 rounded-xl border border-primary/20 bg-primary/[0.03] space-y-2 animate-in fade-in slide-in-from-top-1">
                              <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
                                <span className="px-2 py-1 bg-muted rounded-md font-medium">ab {req.startHour}. Std, {req.hours}h/Tag</span>
                                <span className="px-2 py-1 bg-muted rounded-md font-medium">Quals: {req.qualifications || 'Beliebig'}</span>
                                <span className="px-2 py-1 bg-muted rounded-md font-medium">Für: {req.substitutedTeacher || '-'}</span>
                              </div>
                              {req.assignments && req.assignments.length > 0 && (
                                <ConfirmationSummary assignments={req.assignments} />
                              )}
                              {req.assignments && req.assignments.length > 0 && (
                                <AssignmentRows assignments={req.assignments} isDeleting={isDeleting} setIsDeleting={setIsDeleting} loadData={loadData} />
                              )}
                              {req.comments && (
                                <Popover>
                                  <PopoverTrigger>
                                    <div className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-1.5 rounded-md flex items-start gap-1.5 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
                                      <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                      <span className="line-clamp-2">{req.comments}</span>
                                    </div>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-80 text-sm">
                                    <p className="font-semibold mb-1 text-foreground">Kommentar</p>
                                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{req.comments}</p>
                                  </PopoverContent>
                                </Popover>
                              )}
                              <div className="pt-1 flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={unfillingId === req.id}
                                  onClick={(e) => { e.stopPropagation(); markUnfilled(req); }}
                                  className="gap-1.5 text-rose-700 border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-900/60 dark:hover:bg-rose-950/40"
                                >
                                  <Ban className="w-3.5 h-3.5" />
                                  {unfillingId === req.id ? 'Wird gespeichert…' : 'Keine Reserve verfügbar'}
                                </Button>
                                {/* Meldet die Schule telefonisch, dass die Kollegin zurück
                                    ist, trägt das Schulamt die Rückkehr hier ein. */}
                                {req.isOpenEnded && !req.endDate && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={unfillingId === req.id}
                                    onClick={(e) => { e.stopPropagation(); endOpenRequest(req); }}
                                    className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900/60 dark:hover:bg-emerald-950/40"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Rückkehr melden
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* CANDIDATES LIST */}
          {activeRequest && (
            <div className="mt-6 border-t border-border pt-6 animate-in fade-in slide-in-from-top-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  Top Kandidaten für {activeRequest.school.name}
                </h3>
                <Button variant="outline" className="gap-2 text-primary hover:text-primary/80" onClick={openManualAssignModal}>
                  Manuell überschreiben
                </Button>
              </div>

              {candidates.length === 0 ? (
                <div className="p-4 bg-red-50 text-red-800 rounded-xl border border-red-100 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300">
                  Keine verfügbaren Kandidaten gefunden (Krankmeldung etc.).
                </div>
              ) : (
                <div className="space-y-4">
                  {topCandidates.length === 0 && (
                    <div className="p-4 bg-amber-50 text-amber-800 rounded-xl border border-amber-100 dark:bg-amber-950/30 dark:border-amber-900/50 dark:text-amber-300">
                      Keine regulären Kandidaten verfügbar.
                    </div>
                  )}
                  {topCandidates.map((candidate) => {
                    return (
                      <div
                        key={candidate.id}
                        className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border border-border/60 rounded-2xl bg-card/70 backdrop-blur-sm hover:bg-card shadow-sm hover:shadow-md hover:scale-[1.01] hover:border-primary/20 transition-all duration-300 gap-4"
                      >
                        <div className="flex items-center gap-4 w-full sm:w-auto">
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-2">
                              <div className="font-bold text-lg text-foreground">{candidate.name}</div>
                              <div className="text-right">
                                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                                  {(candidate.matchScore || 0).toFixed(0)} Pkt
                                </Badge>
                                <div className="text-[10px] text-muted-foreground mt-1">{(candidate.distanceToSchool || 0).toFixed(1)} km entfernt</div>
                              </div>
                            </div>

                            {candidate.hasConflict && (
                              <div className="text-[11px] font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/15 px-2 py-1 rounded-md mb-2 inline-block">
                                ⚠️ Terminkonflikt{candidate.conflictDates && candidate.conflictDates.length > 0 ? `: ${candidate.conflictDates.map(d => new Date(d).toLocaleDateString('de-DE')).join(', ')}` : ''}
                              </div>
                            )}

                            <div className="text-sm text-muted-foreground mt-2 flex flex-wrap gap-2.5 items-center">
                              <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded-lg text-xs font-medium text-muted-foreground">
                                <div className="text-muted-foreground flex items-center gap-1">
                                  <Navigation className="h-3 w-3" /> {(candidate.distanceToSchool || 0).toFixed(1)} km
                                </div>
                              </span>
                              <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded-lg text-xs font-medium text-muted-foreground">
                                <Clock className="h-3.5 w-3.5 text-chart-2 shrink-0" />
                                {candidate.assignedHours}/{candidate.maxWeeklyHours}h
                              </span>
                              <span className="text-[11px] bg-muted px-2 py-0.5 rounded-lg text-muted-foreground font-medium">
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
                  {overtimeCandidates.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-border">
                      <h4 className="font-semibold text-md mb-4 flex items-center gap-2 text-amber-600 dark:text-amber-500">
                        ⚠️ Zusätzliche Kandidaten (Mehrarbeit)
                      </h4>
                      <div className="space-y-4">
                        {overtimeCandidates.map((candidate) => (
                          <div
                            key={candidate.id}
                            className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border border-amber-200/60 dark:border-amber-800/60 rounded-2xl bg-amber-50/50 dark:bg-amber-900/10 backdrop-blur-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 shadow-sm transition-all duration-300 gap-4"
                          >
                            <div className="flex items-center gap-4 w-full sm:w-auto">
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start mb-2">
                                  <div className="font-bold text-lg text-foreground">{candidate.name}</div>
                                  <div className="text-right">
                                    <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800">
                                      {(candidate.matchScore || 0).toFixed(0)} Pkt
                                    </Badge>
                                    <div className="text-[10px] text-muted-foreground mt-1">{(candidate.distanceToSchool || 0).toFixed(1)} km entfernt</div>
                                  </div>
                                </div>

                                {candidate.hasConflict && (
                                  <div className="text-[11px] font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/15 px-2 py-1 rounded-md mb-2 inline-block">
                                    ⚠️ Terminkonflikt{candidate.conflictDates && candidate.conflictDates.length > 0 ? `: ${candidate.conflictDates.map(d => new Date(d).toLocaleDateString('de-DE')).join(', ')}` : ''}
                                  </div>
                                )}

                                <div className="text-sm text-muted-foreground mt-2 flex flex-wrap gap-2.5 items-center">
                                  <span className="flex items-center gap-1 bg-card/60 px-2 py-0.5 rounded-lg text-xs font-medium text-muted-foreground">
                                    <Navigation className="h-3 w-3 text-muted-foreground" /> {(candidate.distanceToSchool || 0).toFixed(1)} km
                                  </span>
                                  <span className="flex items-center gap-1 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded-lg text-xs font-medium text-red-700 dark:text-red-400">
                                    <Clock className="h-3.5 w-3.5 shrink-0" />
                                    {candidate.assignedHours}/{candidate.maxWeeklyHours}h
                                  </span>
                                  <span className="text-[11px] bg-card/60 px-2 py-0.5 rounded-lg text-muted-foreground font-medium">
                                    {candidate.qualifications}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <Button
                              onClick={() => openAssignModal(candidate)}
                              variant="outline"
                              className="w-full sm:w-auto border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/40 font-bold transition-all active:scale-95 rounded-xl px-5 h-10 shrink-0"
                            >
                              Zuweisen
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ABGESAGTE BEDARFE (UNFILLED) – rücknehmbar, solange sich die Lage ändern kann */}
      {unfilledRequests.length > 0 && (
        <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60 mt-6">
          <CardHeader className="pb-3 border-b border-border bg-muted/50">
            <CardTitle className="text-xl text-rose-700 dark:text-rose-400 flex items-center gap-2">
              <Ban className="h-5 w-5" />
              Abgesagte Bedarfe ({unfilledRequests.length})
            </CardTitle>
            <CardDescription>
              Für diese Anfragen wurde der Schule mitgeteilt, dass keine Mobile Reserve gestellt
              werden kann. Wird doch jemand frei, holen Sie die Anfrage hier zurück.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-1.5">
              {unfilledRequests.map(req => (
                <div
                  key={req.id}
                  className="px-3 py-2 rounded-xl border border-border bg-card shadow-sm flex items-center gap-2.5 flex-wrap"
                >
                  <span className="font-semibold text-sm text-foreground truncate">{req.school.name}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(req.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                    {req.endDate && `–${new Date(req.endDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`}
                  </span>
                  {req.unfilledReason && (
                    <Popover>
                      <PopoverTrigger>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md cursor-pointer hover:bg-muted/70 truncate max-w-[14rem] inline-block align-middle">
                          {req.unfilledReason}
                        </span>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 text-sm">
                        <p className="font-semibold mb-1 text-foreground">Begründung</p>
                        <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{req.unfilledReason}</p>
                      </PopoverContent>
                    </Popover>
                  )}
                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-auto">
                    {req.unfilledAt && `abgesagt am ${new Date(req.unfilledAt).toLocaleDateString('de-DE')}`}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unfillingId === req.id}
                    onClick={() => revertUnfilled(req)}
                    className="gap-1.5 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {unfillingId === req.id ? 'Wird geöffnet…' : 'Zurückholen'}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ERFOLGREICH ZUGEWIESENE BEDARFE (FILLED) */}
      <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60 mt-6 transition-all opacity-80 hover:opacity-100">
        <CardHeader className="pb-3 border-b border-border bg-muted/50">
          <CardTitle className="text-xl text-emerald-700 dark:text-emerald-500 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            Letzte erfolgreich zugewiesene Bedarfe (max. 30)
          </CardTitle>
          <CardDescription>Diese Bedarfe sind vollständig abgedeckt. Klicken Sie auf eine Anfrage, um die Zuweisungen zu verwalten oder zu stornieren.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {filledRequests.length === 0 ? (
            <p className="text-muted-foreground italic py-4">Keine abgeschlossenen Anfragen vorhanden.</p>
          ) : (
            <div className="space-y-1.5">
              {filledRequests.map(req => {
                const isActive = activeRequest?.id === req.id;
                const active = req.assignments?.filter((a: AssignmentData) => a.status !== 'REJECTED') || [];
                const confirmed = active.filter((a: AssignmentData) => a.status === 'ACCEPTED').length;
                const allConfirmed = active.length > 0 && confirmed === active.length;
                return (
                  <div key={req.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={isActive}
                      aria-label={`Besetzter Bedarf ${req.school.name} am ${new Date(req.date).toLocaleDateString('de-DE')} – Zuweisungen verwalten`}
                      onClick={() => handleMatch(req)}
                      onKeyDown={handleCardKeyDown(() => handleMatch(req))}
                      className={`px-3 py-2 rounded-xl border cursor-pointer transition-all flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                        isActive
                          ? 'border-emerald-400 bg-emerald-50/60 dark:bg-emerald-900/20 ring-2 ring-emerald-500/15'
                          : 'border-border hover:border-emerald-300 bg-card shadow-sm'
                      }`}
                    >
                      {isActive ? <ChevronDown className="w-4 h-4 text-emerald-600 shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <span className="font-semibold text-sm text-foreground truncate">{req.school.name}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(req.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                        {req.endDate && `–${new Date(req.endDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`}
                      </span>
                      <span className="text-xs text-muted-foreground truncate hidden sm:inline">{teacherSummary(req.assignments)}</span>
                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-auto">{req.weeklyHours}h</span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 flex items-center gap-1 ${
                          allConfirmed
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                        }`}
                        title={allConfirmed ? 'Von allen Lehrkräften bestätigt' : 'Bestätigung ausstehend'}
                      >
                        {allConfirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {confirmed}/{active.length}
                      </span>
                    </div>

                    {isActive && (
                      <div className="mt-1.5 ml-6 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] space-y-2 animate-in fade-in slide-in-from-top-1">
                        <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
                          <span className="px-2 py-1 bg-muted rounded-md font-medium flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-emerald-500" />
                            {new Date(req.date).toLocaleDateString('de-DE')}
                            {req.endDate && ` – ${new Date(req.endDate).toLocaleDateString('de-DE')}`}
                          </span>
                          <span className="px-2 py-1 bg-muted rounded-md font-medium">Für: {req.substitutedTeacher || '-'}</span>
                          <span className="px-2 py-1 bg-muted rounded-md font-medium">Quals: {req.qualifications || 'Beliebig'}</span>
                        </div>
                        {req.assignments && req.assignments.length > 0 && (
                          <>
                            <ConfirmationSummary assignments={req.assignments} />
                            <AssignmentRows assignments={req.assignments} isDeleting={isDeleting} setIsDeleting={setIsDeleting} loadData={loadData} showPdf />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
