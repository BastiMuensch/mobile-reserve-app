import { deploymentSchoolName } from "@/lib/schoolLocations";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { CheckCircle2, Clock, Calendar, FileDown, MessageSquare, ChevronDown, ChevronRight, Flame, School, Ban, RotateCcw, Wand2 } from "lucide-react";
import { requestUrgencyScore, urgencyReasons, isSchoolInOutbreak } from "@/lib/urgency";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { RequestData, TeacherData, AssignmentData } from "@/types/models";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getOpenRequestDays, getRequestCoverageStatus, getNextOpenRequestDate } from '@/lib/requestDays';
import { activeUnfilledDays } from '@/lib/unfilledDays';
import { toLocalDateInputValue } from "@/lib/dateKey";
import { RequestUrgencyBadge, RequestUrgencyNote } from "./RequestUrgencyNote";
import { RequestCandidates } from './RequestCandidates';
import { partitionRequestHistory, type UnfilledHistoryEntry } from '@/lib/requestHistory';
import { requestPriorityLabel } from '@/lib/requestPriority';
import { requestLessonSummary } from '@/lib/requestLessonSummary';
import { RequestWeekdaySummary } from './RequestWeekdaySummary';

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
          const body = await res.json();
          if (body.notificationWarning) toast({ variant: 'info', title: 'Zuweisung aufgehoben – Benachrichtigung prüfen', description: body.notificationWarnings?.join(' ') });
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
      {[...assignments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map((assign) => {
        const d = new Date(assign.date);
        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
        return (
          <div key={assign.id} className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center justify-between gap-1 w-full bg-emerald-50 dark:bg-emerald-900/20 p-1.5 rounded">
            <div className="flex-1 min-w-0">
              👤 <span className="font-semibold">{assign.teacher?.name}</span> ({dayName}, {d.toLocaleDateString('de-DE')} - {assign.hours}h)
              {assign.status !== 'REJECTED' && !!assign.cancelledHours && <span className="block text-amber-800 dark:text-amber-300">Tagesbedarf abgeschlossen · {assign.cancelledHours} Reststunden wegen Reservemangels abgesagt</span>}
              <span className={`ml-2 px-1.5 py-0.5 rounded text-xs uppercase ${assignmentStatusBadgeClass(assign.status)}`}>{assignmentStatusLabel(assign.status)}</span>
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
    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${style}`}>
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
  matching?: boolean;
  matchError?: string | null;
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
  matching = false,
  matchError = null,
  openAssignModal,
  openManualAssignModal,
  isDeleting,
  setIsDeleting,
  loadData,
  outbreakDays
}: RequestsListProps) {

  const { toast } = useToast();
  const confirm = useConfirm();
  const [unfillingId, setUnfillingId] = useState<string | null>(null);
  const [unfilledDates, setUnfilledDates] = useState<Record<string, string>>({});
  const [sortOrder, setSortOrder] = useState<'date' | 'urgency'>('date');
  const [historyView, setHistoryView] = useState<'recent' | 'archive'>('recent');

  const currentRequests = filteredRequests.map(request => ({
    ...request, status: getRequestCoverageStatus(request, request.assignments),
  }));
  const openRequests = currentRequests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED');
  const activeRequestStatus = activeRequest ? getRequestCoverageStatus(activeRequest, activeRequest.assignments) : null;

  /** Merkmale und Punktwert einer Anfrage – Häufung kommt aus der Erkennung plus Übersteuerung. */
  const urgencyOf = (req: RequestData) => {
    const isOutbreak = isSchoolInOutbreak(req.school, outbreakDays, req);
    return {
      isOutbreak,
      score: requestUrgencyScore(req, req.school, { isOutbreak }),
      reasons: urgencyReasons(req, req.school, { isOutbreak }),
    };
  };

  const nextOpenDate = (request: RequestData) => getNextOpenRequestDate(request, request.assignments);
  const compareDates = (a: RequestData, b: RequestData) => nextOpenDate(a).localeCompare(nextOpenDate(b)) || urgencyOf(b).score - urgencyOf(a).score;
  const urgencyGroups: Record<string, RequestData[]> = sortOrder === 'date'
    ? { date: [...openRequests].sort(compareDates) }
    : { urgency: [...openRequests].sort((a, b) => urgencyOf(b).score - urgencyOf(a).score || compareDates(a, b)) };
  const requestGroups = sortOrder === 'date'
    ? [{ id: 'date', label: 'Nach Datum' }]
    : [{ id: 'urgency', label: 'Nach Dringlichkeit' }];

  const unfilledRequests = currentRequests
    .filter(r => r.status !== 'CANCELLED' && (r.status === 'UNFILLED' || activeUnfilledDays(r.unfilledDays).length > 0))
    .sort(compareDates);
  const allUnfilledEntries = unfilledRequests.flatMap<UnfilledHistoryEntry>(req => {
    const days = activeUnfilledDays(req.unfilledDays);
    return days.length > 0
      ? days.map(day => ({ req, date: day.date, reason: day.reason, decidedAt: day.decidedAt }))
      : [{ req, date: undefined, reason: req.unfilledReason, decidedAt: req.unfilledAt }];
  }).sort((a, b) => (a.date ?? a.req.date).localeCompare(b.date ?? b.req.date));

  const selectedUnfilledDate = (req: RequestData) => {
    const days = getOpenRequestDays(req, req.assignments);
    const selected = unfilledDates[req.id];
    if (days.some(day => day.date === selected)) return selected;
    return days.find(day => day.date >= toLocalDateInputValue())?.date ?? days[0]?.date;
  };

  /** Absage für den ausgewählten Tag bestätigen und die Schule informieren lassen. */
  const markUnfilled = async (req: RequestData) => {
    const date = selectedUnfilledDate(req);
    if (!date) return;
    const ok = await confirm({
      title: 'Keine Reserve verfügbar?',
      description: `Die Schule ${deploymentSchoolName(req)} wird per E-Mail informiert, dass für ${req.substitutedTeacher || 'die angefragte Vertretung'}${req.className ? ` (Klasse ${req.className})` : ''} am ${new Date(date).toLocaleDateString('de-DE')} keine Mobile Reserve gestellt werden kann. Die Absage gilt nur für diesen Tag; weitere Tage bleiben offen. Sie lässt sich später zurücknehmen.`,
      confirmLabel: 'Absagen',
      variant: 'destructive',
    });
    if (!ok) return;

    setUnfillingId(req.id);
    try {
      const res = await fetch(`/api/requests/${req.id}/unfilled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ variant: 'error', title: err.error || 'Die Absage konnte nicht gespeichert werden.' });
        return;
      }
      const body = await res.json();
      toast({ variant: body.notificationWarning ? 'info' : 'success', title: body.notificationWarning ? 'Absage gespeichert – Benachrichtigung prüfen' : 'Absage gespeichert', description: body.notificationWarning ? body.notificationWarnings?.join(' ') : 'Die Benachrichtigung wurde verarbeitet.' });
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
      description: `Die Vertretung an der Schule ${deploymentSchoolName(req)} endet mit dem heutigen Tag (${heute.toLocaleDateString('de-DE')}). Geplante Einsätze danach werden storniert und die betroffenen Lehrkräfte informiert.`,
      confirmLabel: 'Rückkehr melden',
    });
    if (!ok) return;

    setUnfillingId(req.id);
    try {
      const res = await fetch(`/api/requests/${req.id}/end`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastDay: toLocalDateInputValue(heute) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: 'error', title: body.error || 'Die Rückkehr konnte nicht gemeldet werden.' });
        return;
      }
      toast({
        variant: body.notificationWarning ? 'info' : 'success',
        title: body.notificationWarning ? 'Rückkehr gemeldet – Benachrichtigung prüfen' : 'Rückkehr gemeldet',
        description: body.notificationWarning ? body.notificationWarnings?.join(' ') : body.cancelledAssignments > 0
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
  const revertUnfilled = async (req: RequestData, date?: string) => {
    setUnfillingId(req.id);
    try {
      const res = await fetch(`/api/requests/${req.id}/unfilled`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ variant: 'error', title: err.error || 'Die Absage konnte nicht zurückgenommen werden.' });
        return;
      }
      const body = await res.json();
      toast({ variant: body.notificationWarning ? 'info' : 'success', title: 'Absage zurückgenommen', description: body.notificationWarning ? body.notificationWarnings?.join(' ') : 'Der Bedarf wird wieder berücksichtigt.' });
      loadData();
    } catch {
      toast({ variant: 'error', title: 'Netzwerkfehler. Bitte versuchen Sie es erneut.' });
    } finally {
      setUnfillingId(null);
    }
  };

  const allAssignedRequests = currentRequests
    .filter(r => r.status !== 'CANCELLED' && r.assignments?.some(assignment => assignment.status !== 'REJECTED'))
    .sort(compareDates);
  const history = partitionRequestHistory(allAssignedRequests, allUnfilledEntries);
  const assignedRequests = history[historyView].assigned;
  const unfilledEntries = history[historyView].unfilled;
  const archivedCount = history.archive.assigned.length + history.archive.unfilled.length;

  const requestDetails = (req: RequestData) => (
    <div className="space-y-3 pt-2">
      <RequestUrgencyNote note={req.urgencyNote} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Benötigt: {req.qualifications || 'Keine Schulart vorgegeben'} · {requestLessonSummary(req)}
      </p>
      {req.assignments && req.assignments.length > 0 && <>
        <ConfirmationSummary assignments={req.assignments} />
        <AssignmentRows assignments={req.assignments} isDeleting={isDeleting} setIsDeleting={setIsDeleting} loadData={loadData} />
      </>}
      {req.comments && (
        <Popover>
          <PopoverTrigger>
            <div className="flex cursor-pointer items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70">
              <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
              <span className="line-clamp-2">{req.comments}</span>
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-80 text-sm">
            <p className="mb-1 font-semibold text-foreground">Kommentar</p>
            <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{req.comments}</p>
          </PopoverContent>
        </Popover>
      )}
      {req.isOpenEnded && !req.endDate && (
        <Button variant="outline" size="sm" disabled={unfillingId === req.id}
          onClick={(e) => { e.stopPropagation(); endOpenRequest(req); }}
          className="gap-1.5 text-primary">
          <CheckCircle2 className="size-3.5" />Rückkehr melden
        </Button>
      )}
    </div>
  );
  const requestRejectionAction = (req: RequestData) => (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-muted-foreground">
        Absage für
        <select
          aria-label={`Tag für Absage an ${deploymentSchoolName(req)} für ${req.substitutedTeacher || 'die angefragte Vertretung'}`}
          value={selectedUnfilledDate(req) ?? ''}
          onChange={e => setUnfilledDates(current => ({ ...current, [req.id]: e.target.value }))}
          disabled={unfillingId === req.id || !selectedUnfilledDate(req)}
          className="min-h-11 w-full min-w-[9rem] rounded-lg border border-border bg-card px-2 text-sm text-foreground"
        >
          {getOpenRequestDays(req, req.assignments).map(day => <option key={day.date} value={day.date}>{new Date(day.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} · {day.hours} Std. offen</option>)}
          {!selectedUnfilledDate(req) && <option value="">Kein offener Tag</option>}
        </select>
      </label>
      <Button variant="outline" size="sm"
        disabled={unfillingId === req.id || !selectedUnfilledDate(req)}
        onClick={(e) => { e.stopPropagation(); markUnfilled(req); }}
        className="min-h-11 gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40">
        <Ban className="size-3.5" />{unfillingId === req.id ? 'Wird gespeichert…' : 'Tag absagen'}
      </Button>
    </div>
  );
  const candidatePanel = activeRequest && (activeRequestStatus === 'PENDING' || activeRequestStatus === 'PARTIALLY_FILLED')
    ? <RequestCandidates request={activeRequest} candidates={candidates} matching={matching} error={matchError} onAssign={openAssignModal} onManualAssign={openManualAssignModal} />
    : null;
  const selectedRequestPanel = (req: RequestData) => <>
    <header className="border-b border-primary/15 bg-card px-4 py-3 lg:sticky lg:top-0 lg:z-10">
      <p className="text-xs font-medium text-primary">Ausgewählter Bedarf</p>
      <h2 className="mt-1 break-words text-base font-semibold">
        {req.substitutedTeacher || 'Vertretene Lehrkraft nicht angegeben'}
        {req.className && <span className="font-medium"> · Klasse {req.className}</span>}
      </h2>
      <p className="mt-1 break-words text-sm text-muted-foreground">{deploymentSchoolName(req)}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Ab {new Date(nextOpenDate(req)).toLocaleDateString('de-DE')} · {requestPriorityLabel(req.priority)}
      </p>
    </header>
    <div className="space-y-4 p-4">
      {requestRejectionAction(req)}
      <details className="border-b border-border pb-2">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Bedarfsdetails & weitere Aktionen</summary>
        {requestDetails(req)}
      </details>
      {candidatePanel}
    </div>
  </>;

  return (
    <>
      <Card id="matching-engine" className="overflow-visible bg-card ring-border/70 shadow-none scroll-mt-5 py-6 gap-5">
        <CardHeader className="px-5 sm:px-6 pb-0 flex flex-col gap-5">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg font-semibold">Bedarfe besetzen <span className="font-normal text-muted-foreground">({openRequests.length} offen)</span></CardTitle>
            {openRequests.length > 1 && <Link href="/schulamt/idealbesetzung" className="inline-flex items-center gap-2 rounded text-sm text-primary font-medium hover:underline focus-visible:outline-2 focus-visible:outline-primary"><Wand2 className="size-4" />Besetzungsvorschläge<ChevronRight className="size-4" /></Link>}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Sortierung
            <select aria-label="Bedarfe sortieren" value={sortOrder} onChange={e => setSortOrder(e.target.value as 'date' | 'urgency')} className="min-h-11 rounded-lg border border-border bg-card px-3 text-foreground">
              <option value="date">Datum, aufsteigend</option>
              <option value="urgency">Dringlichkeit</option>
            </select>
          </label>
          <Input
            placeholder="Suche (Schule, Grund)..."
            aria-label="Bedarfe nach Schule oder Grund durchsuchen"
            value={searchRequestQuery}
            onChange={e => setSearchRequestQuery(e.target.value)}
            className="w-full min-h-11 bg-card border-border rounded-lg focus-visible:ring-primary"
          />
        </CardHeader>
        <CardContent className="px-4 sm:px-5">
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"><div className="min-w-0">
          {openRequests.length === 0 ? (
            <p className="text-muted-foreground italic py-4">Keine offenen Bedarfe gefunden.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {requestGroups.map(group => {
                const groupRequests = urgencyGroups[group.id];
                if (groupRequests.length === 0) return null;
                const rows = groupRequests.map(req => {
                      const isActive = activeRequest?.id === req.id;
                      const nextDate = nextOpenDate(req);
                      // Die schulbezogenen Merkmale bleiben in der kompakten Zeile sichtbar.
                      const chips = urgencyOf(req).reasons.filter(r => r === 'Kleine Schule' || r === 'Häufung');
                      return (
                        <div key={req.id}>
                          {/* Kompakte Zeile: alles Wesentliche auf einen Blick, Details erst im aufgeklappten Zustand */}
                          <div
                            role="button"
                            tabIndex={0}
                            aria-expanded={isActive}
                            aria-label={`Bedarf für ${req.substitutedTeacher || 'nicht angegebene Lehrkraft'}${req.className ? `, Klasse ${req.className}` : ""} an ${deploymentSchoolName(req)} am ${new Date(nextDate).toLocaleDateString('de-DE')}${req.urgencyNote ? ' – Dringlichkeitshinweis vorhanden' : ''} – passende Lehrkräfte suchen`}
                            onClick={() => handleMatch(req)}
                            onKeyDown={handleCardKeyDown(() => handleMatch(req))}
                            className={`px-3 py-4 cursor-pointer transition-colors grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                              isActive
                                ? 'bg-primary/10 ring-1 ring-primary/30 border-l-4 border-l-primary'
                                : 'hover:bg-muted/50'
                            }`}
                          >
                            <span className="min-w-0 col-span-2">
                              <span className="min-w-0 flex-1 space-y-2 block">
                                <span className="block break-words text-sm text-muted-foreground">{deploymentSchoolName(req)}</span>
                                <span className="block break-words text-base font-semibold text-foreground">
                                  {req.substitutedTeacher || 'Vertretene Lehrkraft nicht angegeben'}
                                  {req.className && <span className="font-medium"> · Klasse {req.className}</span>}
                                </span>
                            <span className="text-xs text-muted-foreground block leading-relaxed">
                              Ab {new Date(nextDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                              {req.endDate && ` · Zeitraum ${new Date(req.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}–${new Date(req.endDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`}
                              {req.isOpenEnded && !req.endDate && ' · Ende offen'}
                            </span>
                            <span className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary" className={`h-auto min-h-5 max-w-full whitespace-normal text-left leading-relaxed ${req.priority === 'UNPLANNED_ABSENCE' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-primary/10 text-primary'}`}>
                                {requestPriorityLabel(req.priority)}
                              </Badge>
                              {chips.map(reason => <UrgencyChip key={reason} reason={reason} />)}
                              <RequestUrgencyBadge note={req.urgencyNote} />
                            </span>
                            <RequestWeekdaySummary request={req} />
                              </span>
                            </span>
                            <span className={`col-span-2 justify-self-start inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium whitespace-nowrap ${isActive ? 'bg-primary border-primary text-primary-foreground' : 'border-primary/40 text-primary'}`}>
                              {isActive ? 'Details schließen' : 'Reserve finden'}{isActive ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </span>
                          </div>

                          {isActive && (
                            <div className="rounded-lg border border-primary/15 bg-card lg:hidden">
                              {selectedRequestPanel(req)}
                            </div>
                          )}
                        </div>
                      );
                    });
                return (
                  <section key={group.id} aria-label={group.label} className="divide-y divide-border/70">
                    {rows}
                  </section>
                );
              })}
            </div>
          )}

          </div>
          <aside key={activeRequest?.id ?? 'no-selection'} aria-label="Details zum ausgewählten Bedarf" className="hidden min-w-0 rounded-xl border border-primary/20 bg-card lg:sticky lg:top-5 lg:block lg:max-h-[calc(100dvh-2.5rem)] lg:overflow-y-auto">
            {activeRequest && openRequests.some(request => request.id === activeRequest.id)
              ? selectedRequestPanel(activeRequest)
              : <p className="px-4 py-8 text-center text-sm text-muted-foreground">Wählen Sie einen offenen Bedarf. Die passenden Lehrkräfte erscheinen hier.</p>}
          </aside>
          </div>
        </CardContent>
      </Card>

      <section aria-label="Bedarfsverlauf" className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Besetzte Bedarfe & Tage ohne Reserve</h2>
          <div role="group" aria-label="Zeitraum des Bedarfsverlaufs" className="flex flex-wrap gap-2">
            <Button variant={historyView === 'recent' ? 'secondary' : 'outline'} size="sm" aria-pressed={historyView === 'recent'} onClick={() => setHistoryView('recent')}>Aktuell & letzte 7 Tage</Button>
            <Button variant={historyView === 'archive' ? 'secondary' : 'outline'} size="sm" aria-pressed={historyView === 'archive'} onClick={() => setHistoryView('archive')}>Archiv ({archivedCount})</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {historyView === 'recent'
            ? 'Heute und die sechs vorherigen Tage. Laufende und kommende Einsätze bleiben sichtbar. Ältere Einträge finden Sie im Archiv.'
            : `Ältere Einträge vor dem ${new Date(`${history.cutoff}T12:00:00`).toLocaleDateString('de-DE')}. Zugewiesene Einsätze, Bestätigungen und Absagen bleiben beim Wechsel ins Archiv erhalten.`}
        </p>

      {/* ABGESAGTE BEDARFE (UNFILLED) – rücknehmbar, solange sich die Lage ändern kann */}
      {unfilledEntries.length > 0 && (
        <Card className="shadow-none bg-card ring-border/70 mt-6">
          <CardHeader className="pb-3 border-b border-border bg-muted/50">
            <CardTitle className="text-xl text-rose-700 dark:text-rose-400 flex items-center gap-2">
              <Ban className="h-5 w-5" />
              Tage ohne Reserve ({unfilledEntries.length})
            </CardTitle>
            <CardDescription>
              Diese Tage wurden der Schule als unbesetzt gemeldet. Andere Tage derselben Anforderung bleiben offen. Wird eine Reserve frei, nehmen Sie die jeweilige Absage zurück.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-1.5">
              {unfilledEntries.map(({ req, date, reason, decidedAt }) => (
                <div
                  key={`${req.id}-${date ?? 'legacy'}`}
                  className="px-3 py-2 rounded-xl border border-border bg-card shadow-sm flex items-center gap-2.5 flex-wrap"
                >
                  <span className="font-semibold text-sm text-foreground truncate">{deploymentSchoolName(req)}</span>
                  <RequestUrgencyBadge note={req.urgencyNote} />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(date ?? req.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                    {!date && req.endDate && `–${new Date(req.endDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`}
                  </span>
                  {reason && (
                    <Popover>
                      <PopoverTrigger>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md cursor-pointer hover:bg-muted/70 truncate max-w-[14rem] inline-block align-middle">
                          {reason}
                        </span>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 text-sm">
                        <p className="font-semibold mb-1 text-foreground">Begründung</p>
                        <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{reason}</p>
                      </PopoverContent>
                    </Popover>
                  )}
                  {req.urgencyNote && <div className="w-full"><RequestUrgencyNote note={req.urgencyNote} /></div>}
                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-auto">
                    {decidedAt && `abgesagt am ${new Date(decidedAt).toLocaleDateString('de-DE')}`}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unfillingId === req.id}
                    onClick={() => revertUnfilled(req, date)}
                    className="gap-1.5 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {unfillingId === req.id ? 'Wird geöffnet…' : 'Absage zurücknehmen'}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alle aktiven Zuweisungen, auch aus nur teilweise besetzten Anforderungen. */}
      <details className="mt-4 rounded-xl border border-border bg-card shadow-sm" open={historyView === 'archive' || (activeRequest && assignedRequests.some(request => request.id === activeRequest.id)) ? true : undefined}>
      <summary className="cursor-pointer p-4 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary">Besetzte Bedarfe ansehen ({assignedRequests.length})</summary>
      <Card className="bg-card border-0 shadow-none ring-0">
        <CardHeader className="pb-3 border-b border-border bg-muted/50">
          <CardTitle className="text-xl text-emerald-700 dark:text-emerald-500 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            Besetzte Bedarfe nach Datum
          </CardTitle>
          <CardDescription>{historyView === 'archive' ? 'Ältere besetzte Bedarfe mit ihren vollständigen Zuweisungen.' : 'Aktuelle, kommende und in den letzten sieben Tagen besetzte Bedarfe, einschließlich teilweise besetzter und mehrtägiger Anforderungen.'} Klicken Sie auf eine Anfrage, um die Einsätze und Bestätigungen je Tag zu sehen.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {assignedRequests.length === 0 ? (
            <p className="text-muted-foreground italic py-4">{historyView === 'archive' ? 'Keine älteren besetzten Bedarfe im Archiv.' : 'Keine besetzten Bedarfe in diesem Zeitraum.'}</p>
          ) : (
            <div className="space-y-1.5">
              {assignedRequests.map(req => {
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
                      aria-label={`Besetzter Bedarf ${deploymentSchoolName(req)} am ${new Date(req.date).toLocaleDateString('de-DE')}${req.urgencyNote ? ' – Dringlichkeitshinweis vorhanden' : ''} – Zuweisungen verwalten`}
                      onClick={() => handleMatch(req)}
                      onKeyDown={handleCardKeyDown(() => handleMatch(req))}
                      className={`px-3 py-2 rounded-xl border cursor-pointer transition-all flex flex-wrap items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                        isActive
                          ? 'border-emerald-400 bg-emerald-50/60 dark:bg-emerald-900/20 ring-2 ring-emerald-500/15'
                          : 'border-border hover:border-emerald-300 bg-card shadow-sm'
                      }`}
                    >
                      {isActive ? <ChevronDown className="w-4 h-4 text-emerald-600 shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <span className="font-semibold text-sm text-foreground truncate">{deploymentSchoolName(req)}</span>
                      <RequestUrgencyBadge note={req.urgencyNote} />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {req.isOpenEnded && !req.endDate ? 'ab ' : ''}
                        {new Date(req.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                        {req.endDate && `–${new Date(req.endDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`}
                        {req.isOpenEnded && !req.endDate && ' · Ende offen'}
                      </span>
                      <span className="text-xs text-muted-foreground break-words">Reserve: {teacherSummary(active)}</span>
                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-auto">{active.reduce((sum, assignment) => sum + assignment.hours, 0)} Std. zugewiesen</span>
                      <Badge variant="secondary" className="text-xs">{req.status === 'FILLED' ? req.isOpenEnded && !req.endDate ? 'Planungszeitraum besetzt' : 'Vollständig besetzt' : 'Teilweise besetzt'}</Badge>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 flex items-center gap-1 ${
                          allConfirmed
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                        }`}
                        title={allConfirmed ? 'Von allen Lehrkräften bestätigt' : 'Bestätigung ausstehend'}
                      >
                        {allConfirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {confirmed}/{active.length} bestätigt
                      </span>
                      <span className="basis-full text-xs text-muted-foreground break-words">Zu vertreten: <span className="font-medium text-foreground">{req.substitutedTeacher || 'Nicht angegeben'}</span>{req.className ? ` · Klasse ${req.className}` : ''}</span>
                      {!allConfirmed && <span className="basis-full text-xs text-amber-800 dark:text-amber-300 break-words">Nicht bestätigt: {teacherSummary(active.filter(assignment => assignment.status !== 'ACCEPTED')) || `${active.length - confirmed} Zuweisungen`}</span>}
                    </div>

                    {isActive && (
                      <div className="mt-1.5 ml-6 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] space-y-2 animate-in fade-in slide-in-from-top-1">
                        <RequestUrgencyNote note={req.urgencyNote} />
                        <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
                          <span className="px-2 py-1 bg-muted rounded-md font-medium flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-emerald-500" />
                            {new Date(req.date).toLocaleDateString('de-DE')}
                            {req.endDate && ` – ${new Date(req.endDate).toLocaleDateString('de-DE')}`}
                          </span>
                          <span className="px-2 py-1 bg-muted rounded-md font-medium">Für: {req.substitutedTeacher || '-'}</span>
                          {req.className && <span className="px-2 py-1 bg-muted rounded-md">Klasse: {req.className}</span>}
                          <span className="px-2 py-1 bg-muted rounded-md font-medium">Quals: {req.qualifications || 'Beliebig'}</span>
                        </div>
                        {req.assignments && req.assignments.length > 0 && (
                          <>
                            <ConfirmationSummary assignments={req.assignments} />
                            <AssignmentRows assignments={active} isDeleting={isDeleting} setIsDeleting={setIsDeleting} loadData={loadData} showPdf />
                          </>
                        )}
                        {req.isOpenEnded && !req.endDate && (
                          <Button variant="outline" size="sm" disabled={unfillingId === req.id} onClick={(event) => { event.stopPropagation(); endOpenRequest(req); }} className="gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />Rückkehr melden
                          </Button>
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
      </details>
      </section>
    </>
  );
}
