"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Wand2, CheckCircle2, Flame, School, AlertTriangle, Ban } from "lucide-react";

/**
 * Lokale Abbildung des Vertrags von /api/batch-assign/preview und /approve (siehe
 * src/lib/batchMatching.ts). Bewusst hier noch einmal definiert statt aus der Lib
 * importiert: batchMatching.ts hängt transitiv an "@prisma/client" (Typen von
 * matching.ts), und das soll nicht Teil des Client-Bundles dieser Seite werden.
 */
type ProposalSegment = {
  teacherId: string;
  teacherName: string;
  entries: { date: string; hours: number }[];
  score: number;
  reasons: string[];
  alternatives: { teacherId: string; name: string; score: number; reasons: string[] }[];
};

type Proposal = {
  requestId: string;
  segments: ProposalSegment[];
  coverage: { assignedHours: number; requiredHours: number };
  urgency: { score: number; reasons: string[] };
};

type UnfillableEntry = { requestId: string; reason: string };

type SchoolProposal = {
  schoolId: string;
  schoolName: string;
  coverage: { filledRequests: number; totalRequests: number; assignedHours: number; requiredHours: number };
  proposals: Proposal[];
  unfillable: UnfillableEntry[];
};

/** Die für die Anzeige benötigten Felder der zurückgelieferten Request-Zeilen. */
type RequestRow = {
  date: string;
  endDate?: string | null;
  hours: number;
  weeklyHours: number;
  startHour: number;
  qualifications: string;
  substitutedTeacher: string;
  comments?: string | null;
  status: string;
};

type PreviewData = {
  schools: SchoolProposal[];
  requestsById: Record<string, RequestRow>;
};

/** Ausgewählte Lehrkraft je Segment (Auswahl "swap" statt Original-Vorschlag). */
type SwapState = Record<string, { teacherId: string; teacherName: string }>;

function swapKey(requestId: string, segmentIndex: number): string {
  return `${requestId}:${segmentIndex}`;
}

function todayDateInputValue(): string {
  return toDateInputValue(new Date());
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultUntilValue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return toDateInputValue(d);
}

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** "YYYY-MM-DD" -> lokales Date um Mitternacht, ohne Zeitzonen-Verschiebung. */
function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Mo 10.08." */
function formatShortDay(key: string): string {
  const d = parseDateKey(key);
  return `${WEEKDAY_SHORT[d.getDay()]} ${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`;
}

function isNextCalendarDay(a: string, b: string): boolean {
  const diff = (parseDateKey(b).getTime() - parseDateKey(a).getTime()) / 86400000;
  return diff === 1;
}

/** Kompakte Anzeige der von einem Segment abgedeckten Tage. */
function formatSegmentDays(entries: { date: string; hours: number }[]): string {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const consecutive = sorted.length > 1 && sorted.every((e, i) => i === 0 || isNextCalendarDay(sorted[i - 1].date, e.date));
  if (consecutive) {
    return `${formatShortDay(sorted[0].date)} – ${formatShortDay(sorted[sorted.length - 1].date)}`;
  }
  return sorted.map(e => formatShortDay(e.date)).join(", ");
}

/** Datum oder Zeitraum einer Anforderung, wie im Rest der Schulamt-Oberfläche. */
function formatRequestRange(row: RequestRow): string {
  const start = new Date(row.date).toLocaleDateString("de-DE");
  if (!row.endDate) return start;
  const end = new Date(row.endDate).toLocaleDateString("de-DE");
  return start === end ? start : `${start} – ${end}`;
}

/** Farbgebung der Dringlichkeits-Fähnchen, analog zu RequestsList.tsx. */
function urgencyChipClass(reason: string): string {
  switch (reason) {
    case "Häufung":
    case "Überfällig":
      return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
    case "Kleine Schule":
      return "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300";
    case "Ungeplanter Ausfall":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function UrgencyChip({ reason }: { reason: string }) {
  const Icon = reason === "Häufung" ? Flame : reason === "Kleine Schule" ? School : reason === "Überfällig" ? AlertTriangle : null;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${urgencyChipClass(reason)}`}>
      {Icon && <Icon className="w-2.5 h-2.5" />}{reason}
    </span>
  );
}

/** Begründungs-Fähnchen eines Segments: "Mehrarbeit" sticht bewusst als einzige in Amber hervor. */
function ReasonChip({ reason }: { reason: string }) {
  const isOvertime = reason === "Mehrarbeit";
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
        isOvertime
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {reason}
    </span>
  );
}

/** "Name · 82 Pkt · Stammschule" für die Swap-Auswahl. */
function optionLabel(name: string, score: number, reasons: string[]): string {
  const first = reasons[0];
  return first ? `${name} · ${score} Pkt · ${first}` : `${name} · ${score} Pkt`;
}

interface SegmentRowProps {
  requestId: string;
  segmentIndex: number;
  segment: ProposalSegment;
  swaps: SwapState;
  onSwap: (requestId: string, segmentIndex: number, teacherId: string, teacherName: string) => void;
}

/**
 * Eine vorgeschlagene Lehrkraft für einen Teil des Zeitraums. Die Tausch-Auswahl bietet
 * bewusst auch den ursprünglich vorgeschlagenen Namen als Option an (nicht nur die
 * Alternativen), damit ein Tausch ohne Neuberechnung wieder rückgängig gemacht werden
 * kann - die reinen Alternativen allein würden das nicht erlauben.
 */
function SegmentRow({ requestId, segmentIndex, segment, swaps, onSwap }: SegmentRowProps) {
  const key = swapKey(requestId, segmentIndex);
  const effective = swaps[key] ?? { teacherId: segment.teacherId, teacherName: segment.teacherName };

  const options = [
    { teacherId: segment.teacherId, name: segment.teacherName, score: segment.score, reasons: segment.reasons },
    ...segment.alternatives,
  ];
  const labelsById = new Map(options.map(o => [o.teacherId, optionLabel(o.name, o.score, o.reasons)]));

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5 px-2 rounded-lg bg-muted/40 border border-border/60">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground truncate">{effective.teacherName}</div>
        <div className="text-xs text-muted-foreground">{formatSegmentDays(segment.entries)}</div>
      </div>
      <div className="flex flex-wrap gap-1 items-center">
        {segment.reasons.map(reason => <ReasonChip key={reason} reason={reason} />)}
      </div>
      {segment.alternatives.length > 0 && (
        <Select
          value={effective.teacherId}
          onValueChange={(v) => {
            if (!v) return;
            const chosen = options.find(o => o.teacherId === v);
            if (chosen) onSwap(requestId, segmentIndex, chosen.teacherId, chosen.name);
          }}
        >
          <SelectTrigger size="sm" className="ml-auto max-w-full">
            <SelectValue>{(value: string) => labelsById.get(value) ?? value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map(o => (
              <SelectItem key={o.teacherId} value={o.teacherId}>
                {optionLabel(o.name, o.score, o.reasons)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

interface RequestProposalRowProps {
  proposal: Proposal;
  row: RequestRow | undefined;
  checked: boolean;
  onToggle: () => void;
  swaps: SwapState;
  onSwap: (requestId: string, segmentIndex: number, teacherId: string, teacherName: string) => void;
}

function RequestProposalRow({ proposal, row, checked, onToggle, swaps, onSwap }: RequestProposalRowProps) {
  const partial = proposal.coverage.assignedHours < proposal.coverage.requiredHours;
  return (
    <div className="p-3 rounded-xl border border-border bg-card shadow-sm space-y-2">
      <div className="flex flex-wrap items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 rounded border-border accent-primary mt-0.5 shrink-0"
          aria-label={`Anforderung ${row ? formatRequestRange(row) : ""} in die Freigabe aufnehmen`}
        />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground whitespace-nowrap">{row ? formatRequestRange(row) : "?"}</span>
            {proposal.urgency.reasons.map(reason => <UrgencyChip key={reason} reason={reason} />)}
            {partial && (
              <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                Teilbesetzt
              </Badge>
            )}
          </div>
          {row && (
            <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
              <span className="px-2 py-0.5 bg-muted rounded-md font-medium">ab {row.startHour}. Std, {row.hours}h/Tag</span>
              <span className="px-2 py-0.5 bg-muted rounded-md font-medium">Quals: {row.qualifications || "Beliebig"}</span>
              <span className="px-2 py-0.5 bg-muted rounded-md font-medium">Für: {row.substitutedTeacher || "-"}</span>
              <span className="px-2 py-0.5 bg-muted rounded-md font-medium">{proposal.coverage.assignedHours}/{proposal.coverage.requiredHours}h</span>
            </div>
          )}
        </div>
      </div>
      <div className="ml-6 space-y-1.5">
        {proposal.segments.map((segment, idx) => (
          <SegmentRow
            key={idx}
            requestId={proposal.requestId}
            segmentIndex={idx}
            segment={segment}
            swaps={swaps}
            onSwap={onSwap}
          />
        ))}
      </div>
    </div>
  );
}

interface UnfillableRowProps {
  entry: UnfillableEntry;
  row: RequestRow | undefined;
  isOpen: boolean;
  draft: string;
  isSubmitting: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onDraftChange: (v: string) => void;
  onSubmit: () => void;
}

function UnfillableRow({ entry, row, isOpen, draft, isSubmitting, onOpen, onCancel, onDraftChange, onSubmit }: UnfillableRowProps) {
  return (
    <div className="p-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 space-y-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-semibold text-foreground whitespace-nowrap">{row ? formatRequestRange(row) : "?"}</span>
        <span className="text-xs text-muted-foreground flex-1 min-w-[10rem]">{entry.reason}</span>
        {!isOpen && (
          <Button variant="outline" size="sm" onClick={onOpen} className="gap-1.5 text-rose-700 border-rose-200 hover:bg-rose-100 dark:text-rose-400 dark:border-rose-900/60 dark:hover:bg-rose-950/40 shrink-0">
            <Ban className="w-3.5 h-3.5" /> Keine Reserve verfügbar
          </Button>
        )}
      </div>
      {isOpen && (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value.slice(0, 500))}
            placeholder="Begründung für die Schule (optional)"
            className="text-sm"
            rows={2}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{draft.length}/500</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>Abbrechen</Button>
              <Button variant="destructive" size="sm" onClick={onSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Wird gespeichert…" : "Absagen"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface SchoolCardProps {
  school: SchoolProposal;
  requestsById: Record<string, RequestRow>;
  selected: Record<string, boolean>;
  onToggle: (requestId: string) => void;
  swaps: SwapState;
  onSwap: (requestId: string, segmentIndex: number, teacherId: string, teacherName: string) => void;
  onApprove: (school: SchoolProposal) => void;
  isApproving: boolean;
  approvedInfo: { requests: number; assignments: number } | undefined;
  openUnfillableId: string | null;
  unfillableDraft: string;
  unfillingId: string | null;
  onOpenUnfillable: (requestId: string) => void;
  onCancelUnfillable: () => void;
  onDraftChange: (v: string) => void;
  onSubmitUnfillable: (schoolId: string, requestId: string) => void;
}

function SchoolCard({
  school,
  requestsById,
  selected,
  onToggle,
  swaps,
  onSwap,
  onApprove,
  isApproving,
  approvedInfo,
  openUnfillableId,
  unfillableDraft,
  unfillingId,
  onOpenUnfillable,
  onCancelUnfillable,
  onDraftChange,
  onSubmitUnfillable,
}: SchoolCardProps) {
  const selectedCount = school.proposals.filter(p => selected[p.requestId]).length;
  const isDone = approvedInfo !== undefined;

  return (
    <Card className={`shadow-xl bg-card/80 backdrop-blur-sm border-border/60 transition-all ${isDone ? "opacity-70" : ""}`}>
      <CardHeader className="pb-3 flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
            {school.schoolName}
            <Badge variant="outline" className="text-[10px]">
              {school.coverage.filledRequests} von {school.coverage.totalRequests} Anforderungen
            </Badge>
          </CardTitle>
          {isDone ? (
            <CardDescription className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium mt-1">
              <CheckCircle2 className="w-4 h-4" /> Freigegeben: {approvedInfo.requests} Anforderung(en), {approvedInfo.assignments} Einsätze
            </CardDescription>
          ) : (
            <CardDescription>{selectedCount} von {school.proposals.length} ausgewählt</CardDescription>
          )}
        </div>
        {!isDone && (
          <Button onClick={() => onApprove(school)} disabled={selectedCount === 0 || isApproving} className="shrink-0">
            {isApproving ? "Wird freigegeben…" : "Freigeben"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {school.proposals.length > 0 && (
          <div className="space-y-2">
            {school.proposals.map(proposal => (
              <RequestProposalRow
                key={proposal.requestId}
                proposal={proposal}
                row={requestsById[proposal.requestId]}
                checked={Boolean(selected[proposal.requestId])}
                onToggle={() => onToggle(proposal.requestId)}
                swaps={swaps}
                onSwap={onSwap}
              />
            ))}
          </div>
        )}

        {school.unfillable.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-border">
            <h4 className="text-xs font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5" /> Nicht besetzbar ({school.unfillable.length})
            </h4>
            {school.unfillable.map(entry => (
              <UnfillableRow
                key={entry.requestId}
                entry={entry}
                row={requestsById[entry.requestId]}
                isOpen={openUnfillableId === entry.requestId}
                draft={unfillableDraft}
                isSubmitting={unfillingId === entry.requestId}
                onOpen={() => onOpenUnfillable(entry.requestId)}
                onCancel={onCancelUnfillable}
                onDraftChange={onDraftChange}
                onSubmit={() => onSubmitUnfillable(school.schoolId, entry.requestId)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Idealbesetzung: Besetzungsvorschlag für ALLE offenen Anforderungen aller Schulen des
 * Schulamts bis zu einem Stichtag auf einen Schlag, statt jede Anforderung einzeln über
 * die Matching Engine zu bearbeiten. Ab- und Zuwahl sowie Lehrkraft-Tausch sind reiner
 * Client-State, bis pro Schule "Freigeben" gedrückt wird - erst dann prüft und speichert
 * der Server (siehe /api/batch-assign/approve).
 */
export function BatchAssignView() {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [until, setUntil] = useState(defaultUntilValue);
  const [isComputing, setIsComputing] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [data, setData] = useState<PreviewData | null>(null);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [swaps, setSwaps] = useState<SwapState>({});
  const [approvedSchools, setApprovedSchools] = useState<Record<string, { requests: number; assignments: number }>>({});
  const [approvingSchoolId, setApprovingSchoolId] = useState<string | null>(null);

  const [openUnfillableId, setOpenUnfillableId] = useState<string | null>(null);
  const [unfillableDraft, setUnfillableDraft] = useState("");
  const [unfillingId, setUnfillingId] = useState<string | null>(null);

  const handleCompute = async () => {
    setIsComputing(true);
    try {
      const res = await fetch("/api/batch-assign/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ until }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast({ variant: "error", title: body.error || "Der Vorschlag konnte nicht berechnet werden." });
        return;
      }

      const schools = body.schools as SchoolProposal[];
      const initialSelected: Record<string, boolean> = {};
      for (const school of schools) {
        for (const proposal of school.proposals) initialSelected[proposal.requestId] = true;
      }

      setData({ schools, requestsById: body.requestsById });
      setSelected(initialSelected);
      setSwaps({});
      setApprovedSchools({});
      setHasRun(true);
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    } finally {
      setIsComputing(false);
    }
  };

  const toggleSelected = (requestId: string) => {
    setSelected(prev => ({ ...prev, [requestId]: !prev[requestId] }));
  };

  const setSwap = (requestId: string, segmentIndex: number, teacherId: string, teacherName: string) => {
    setSwaps(prev => {
      const key = swapKey(requestId, segmentIndex);
      // Zurück zum ursprünglichen Vorschlag: den Eintrag entfernen statt ihn zu
      // duplizieren, damit der State nicht unnötig wächst.
      const proposal = data?.schools.flatMap(s => s.proposals).find(p => p.requestId === requestId);
      const original = proposal?.segments[segmentIndex];
      if (original && original.teacherId === teacherId) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { teacherId, teacherName } };
    });
  };

  const handleApprove = async (school: SchoolProposal) => {
    const selectedProposals = school.proposals.filter(p => selected[p.requestId]);
    if (selectedProposals.length === 0) return;

    const totalSegments = selectedProposals.reduce((sum, p) => sum + p.segments.length, 0);
    const confirmed = await confirm({
      title: `${school.schoolName} freigeben?`,
      description: `${selectedProposals.length} Anforderung(en) mit ${totalSegments} Zuweisung(en) werden angelegt. Die betroffenen Lehrkräfte werden per E-Mail benachrichtigt.`,
      confirmLabel: "Freigeben",
    });
    if (!confirmed) return;

    setApprovingSchoolId(school.schoolId);
    try {
      const items = selectedProposals.map(p => ({
        requestId: p.requestId,
        segments: p.segments.map((segment, idx) => {
          const key = swapKey(p.requestId, idx);
          const effective = swaps[key];
          return {
            teacherId: effective?.teacherId ?? segment.teacherId,
            entries: segment.entries,
          };
        }),
      }));

      const res = await fetch("/api/batch-assign/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: school.schoolId, items }),
      });
      const body = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          toast({
            variant: "error",
            title: body.error || "Der Vorschlag ist nicht mehr aktuell.",
            description: "Bitte den Vorschlag oben neu berechnen - es wurde nichts übernommen.",
          });
        } else {
          toast({ variant: "error", title: body.error || "Die Freigabe konnte nicht durchgeführt werden." });
        }
        return;
      }

      toast({
        variant: "success",
        title: "Freigabe gespeichert",
        description: `${body.requests} Anforderung(en), ${body.assignments} Einsätze angelegt.`,
      });
      setApprovedSchools(prev => ({ ...prev, [school.schoolId]: { requests: body.requests, assignments: body.assignments } }));
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    } finally {
      setApprovingSchoolId(null);
    }
  };

  const openUnfillable = (requestId: string) => {
    setOpenUnfillableId(requestId);
    setUnfillableDraft("");
  };
  const cancelUnfillable = () => {
    setOpenUnfillableId(null);
    setUnfillableDraft("");
  };

  const submitUnfillable = async (schoolId: string, requestId: string) => {
    setUnfillingId(requestId);
    try {
      const res = await fetch(`/api/requests/${requestId}/unfilled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unfillableDraft.trim() ? { reason: unfillableDraft.trim() } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ variant: "error", title: body.error || "Die Absage konnte nicht gespeichert werden." });
        return;
      }

      toast({ variant: "success", title: "Absage gespeichert", description: "Die Schule wurde informiert." });
      setData(prev => prev ? {
        ...prev,
        schools: prev.schools.map(s => s.schoolId === schoolId
          ? { ...s, unfillable: s.unfillable.filter(u => u.requestId !== requestId) }
          : s),
      } : prev);
      setOpenUnfillableId(null);
      setUnfillableDraft("");
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    } finally {
      setUnfillingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-muted-foreground" /> Idealbesetzung
          </CardTitle>
          <CardDescription>
            Berechnet auf einen Schlag einen Besetzungsvorschlag für alle offenen Anforderungen bis zum Stichtag,
            über alle Schulen hinweg. Knappe Lehrkräfte werden zwischen den Schulen aufgeteilt statt von einer
            Schule vorweggenommen, und für einen Zeitraum wird nach Möglichkeit durchgehend dieselbe Lehrkraft
            vorgeschlagen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="idealbesetzung-until">Stichtag</Label>
              <Input
                id="idealbesetzung-until"
                type="date"
                value={until}
                min={todayDateInputValue()}
                onChange={(e) => setUntil(e.target.value)}
                className="w-44"
              />
            </div>
            <Button onClick={handleCompute} disabled={isComputing || !until}>
              {isComputing ? "Wird berechnet…" : "Vorschlag berechnen"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {hasRun && data && data.schools.length === 0 && (
        <p className="text-muted-foreground italic py-4 text-center">Keine offenen Anforderungen bis zu diesem Stichtag.</p>
      )}

      {data && data.schools.length > 0 && (
        <div className="space-y-4">
          {data.schools.map(school => (
            <SchoolCard
              key={school.schoolId}
              school={school}
              requestsById={data.requestsById}
              selected={selected}
              onToggle={toggleSelected}
              swaps={swaps}
              onSwap={setSwap}
              onApprove={handleApprove}
              isApproving={approvingSchoolId === school.schoolId}
              approvedInfo={approvedSchools[school.schoolId]}
              openUnfillableId={openUnfillableId}
              unfillableDraft={unfillableDraft}
              unfillingId={unfillingId}
              onOpenUnfillable={openUnfillable}
              onCancelUnfillable={cancelUnfillable}
              onDraftChange={setUnfillableDraft}
              onSubmitUnfillable={submitUnfillable}
            />
          ))}
        </div>
      )}
    </div>
  );
}
