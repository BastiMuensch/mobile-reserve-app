"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wand2, CheckCircle2, Flame, School, AlertTriangle, Ban } from "lucide-react";
import {
  batchPlanSegmentKey,
  findTentativeDuplicateTeacherDays,
  makeApprovalPayload,
  makeRecalculationPayload,
  type ApprovalPayload,
  type BatchPlanSchool,
  type BatchPlanSwap,
} from "@/lib/batchPlanClient";
import { toLocalDateInputValue } from "@/lib/dateKey";
import { applyBatchRejection, batchRejectionDays, canRejectBatchRequest, updateBatchExclusionsAfterRejection } from "@/lib/batchPlanRejection";
import { requestPriorityLabel } from "@/lib/requestPriority";
import { requestLessonSummary } from "@/lib/requestLessonSummary";
import { RequestUrgencyNote } from "./RequestUrgencyNote";

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
  warnings?: string[];
  alternatives: { teacherId: string; name: string; score: number; reasons: string[]; warnings?: string[] }[];
};

type Proposal = {
  requestId: string;
  segments: ProposalSegment[];
  coverage: { assignedHours: number; requiredHours: number; cancelledHours?: number };
  urgency: { score: number; reasons: string[] };
};

type UnfillableEntry = { requestId: string; reason: string };

type SchoolProposal = {
  schoolId: string;
  schoolName: string;
  coverage: { filledRequests: number; totalRequests: number; assignedHours: number; requiredHours: number; cancelledHours?: number };
  proposals: Proposal[];
  unfillable: UnfillableEntry[];
};

/** Die für die Anzeige benötigten Felder der zurückgelieferten Request-Zeilen. */
type RequestRow = {
  location?: { name: string } | null;
  date: string;
  endDate?: string | null;
  hours: number;
  weeklyHours: number;
  schedule?: string | null;
  priority?: string | null;
  isOpenEnded?: boolean;
  openDays: { date: string; hours: number }[];
  startHour: number;
  qualifications: string;
  substitutedTeacher: string;
  className?: string | null;
  comments?: string | null;
  urgencyNote?: string | null;
  status: string;
};

type PreviewData = {
  reserveShortageMode: boolean;
  schools: SchoolProposal[];
  requestsById: Record<string, RequestRow>;
  generatedAt: string;
  from: string;
  until: string;
  schoolYear: string;
  retainedRequestIds: string[];
  excludedRequestIds: string[];
};

/** Ausgewählte Lehrkraft je Segment (Auswahl "swap" statt Original-Vorschlag). */
type SwapState = BatchPlanSwap;

function swapKey(requestId: string, segmentIndex: number): string {
  return batchPlanSegmentKey(requestId, segmentIndex);
}

function todayDateInputValue(): string {
  return toLocalDateInputValue();
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
  if (row.isOpenEnded && !row.endDate) return `Ab ${start} · Ende offen`;
  if (!row.endDate) return start;
  const end = new Date(row.endDate).toLocaleDateString("de-DE");
  return start === end ? start : `${start} – ${end}`;
}

type ApprovalSummary = { requests: number; teachers: number; days: number; hours: number; dateRanges: string[] };

/** Die Freigabe-Zusammenfassung zählt die tatsächlich ausgewählten Segmente inkl. Tausch. */
function summarizeApproval(proposals: Proposal[], swaps: SwapState): ApprovalSummary {
  const teachers = new Set<string>();
  const dateKeys = new Set<string>();
  let hours = 0;
  const dateRanges: string[] = [];
  for (const proposal of proposals) {
    for (const [index, segment] of proposal.segments.entries()) {
      if (segment.entries.length === 0) continue;
      teachers.add(swaps[swapKey(proposal.requestId, index)]?.teacherId ?? segment.teacherId);
      for (const entry of segment.entries) {
        dateKeys.add(entry.date);
        hours += entry.hours;
      }
      dateRanges.push(formatSegmentDays(segment.entries));
    }
  }
  return { requests: proposals.length, teachers: teachers.size, days: dateKeys.size, hours, dateRanges };
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
  hasConflict: boolean;
  disabled: boolean;
}

/**
 * Eine vorgeschlagene Lehrkraft für einen Teil des Zeitraums. Die Tausch-Auswahl bietet
 * bewusst auch den ursprünglich vorgeschlagenen Namen als Option an (nicht nur die
 * Alternativen), damit ein Tausch ohne Neuberechnung wieder rückgängig gemacht werden
 * kann - die reinen Alternativen allein würden das nicht erlauben.
 */
function SegmentRow({ requestId, segmentIndex, segment, swaps, onSwap, hasConflict, disabled }: SegmentRowProps) {
  const key = swapKey(requestId, segmentIndex);
  const effective = swaps[key] ?? { teacherId: segment.teacherId, teacherName: segment.teacherName };

  const options = [
    { teacherId: segment.teacherId, name: segment.teacherName, score: segment.score, reasons: segment.reasons, warnings: segment.warnings },
    ...segment.alternatives,
  ];
  const effectiveOption = options.find(option => option.teacherId === effective.teacherId) ?? options[0];
  const labelsById = new Map(options.map(o => [o.teacherId, optionLabel(o.name, o.score, o.reasons)]));

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3 dark:bg-card ${hasConflict ? "border-rose-400 bg-rose-50/50 dark:border-rose-800 dark:bg-rose-950/20" : "border-border/70"}`}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground truncate">{effective.teacherName}</div>
        <div className="text-xs text-muted-foreground">{formatSegmentDays(segment.entries)}</div>
      </div>
      <div className="flex flex-wrap gap-1 items-center">
        {effectiveOption.reasons.map(reason => <ReasonChip key={reason} reason={reason} />)}
        {effectiveOption.warnings?.map((warning, index) => <span key={`${warning}-${index}`} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{warning}</span>)}
        {hasConflict && <span className="text-[10px] font-semibold text-rose-700 dark:text-rose-300">Doppelte Einplanung am selben Tag</span>}
      </div>
      {segment.alternatives.length > 0 && (
        <Select
          value={effective.teacherId}
          disabled={disabled}
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
  conflictingSegmentKeys: Set<string>;
  disabled: boolean;
  approved: boolean;
  rejection: RejectionControlsProps;
}

function RequestPlanningDetails({ row }: { row: RequestRow }) {
  return <details className="text-xs text-muted-foreground">
    <summary className="min-h-9 cursor-pointer py-2 font-medium">Bedarfsdetails</summary>
    <dl className="grid gap-x-5 gap-y-2 pb-2 sm:grid-cols-2">
      <div><dt>Standort</dt><dd className="mt-0.5 text-foreground">{row.location?.name ?? "Hauptstandort"}</dd></div>
      <div><dt>Unterricht</dt><dd className="mt-0.5 text-foreground">{row.schedule ? `${row.weeklyHours} Std./Woche` : `${row.hours} Std./Tag`} · {requestLessonSummary(row)}</dd></div>
      <div><dt>Qualifikation</dt><dd className="mt-0.5 break-words text-foreground">{row.qualifications || "Beliebig"}</dd></div>
      {row.comments && <div className="sm:col-span-2"><dt>Hinweis der Schule</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground">{row.comments}</dd></div>}
    </dl>
  </details>;
}

function RequestProposalRow({ proposal, row, checked, onToggle, swaps, onSwap, conflictingSegmentKeys, disabled, approved, rejection }: RequestProposalRowProps) {
  const selectedOrApproved = checked || approved;
  const segments = proposal.segments.map((segment, idx) => segment.entries.length > 0 && (
    <SegmentRow key={idx} requestId={proposal.requestId} segmentIndex={idx} segment={segment} swaps={swaps} onSwap={onSwap}
      hasConflict={checked && conflictingSegmentKeys.has(swapKey(proposal.requestId, idx))} disabled={disabled || !checked} />
  ));
  return (
    <div className={`space-y-3 rounded-xl border p-4 sm:p-5 ${selectedOrApproved ? "border-border/70 bg-white dark:bg-card" : "border-dashed border-border bg-muted/25"}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          className="h-4 w-4 rounded border-border accent-primary mt-0.5 shrink-0"
          aria-label={`Anforderung für ${row?.substitutedTeacher || "unbekannte Lehrkraft"} ${row ? formatRequestRange(row) : ""} in die Freigabe aufnehmen`}
        />
        <div className="flex-1 min-w-0 space-y-2">
          <h3 className="break-words text-sm font-semibold text-foreground">
            Für: {row?.substitutedTeacher || "Lehrkraft nicht angegeben"}
            {row?.className && <span className="font-normal"> · Klasse: {row.className}</span>}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {row ? formatRequestRange(row) : "Zeitraum nicht verfügbar"}
            {row && <> · {requestPriorityLabel(row.priority)}</>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!selectedOrApproved
              ? <span className="text-xs font-medium text-muted-foreground">Nicht zur Freigabe ausgewählt</span>
              : <span className="text-xs font-medium text-primary">{proposal.coverage.assignedHours} von {proposal.coverage.requiredHours} Std. {approved ? "freigegeben" : "vorgeschlagen"}</span>}
            {proposal.urgency.reasons.filter(reason => ["Häufung", "Überfällig", "Kleine Schule"].includes(reason)).map(reason => <UrgencyChip key={reason} reason={reason} />)}
          </div>
          {selectedOrApproved && !!proposal.coverage.cancelledHours && <p className="text-xs text-amber-800 dark:text-amber-300">{proposal.coverage.cancelledHours} Reststunden {approved ? "wegen Reservemangels abgesagt" : "werden bei Freigabe wegen Reservemangels abgesagt"}.</p>}
        </div>
      </div>
      <div className="space-y-2 pl-0 sm:pl-6">
        <RequestUrgencyNote note={row?.urgencyNote} />
        {selectedOrApproved ? segments : <>
          <p className="text-xs text-muted-foreground">Der Bedarf bleibt offen. Es wurde keine Absage verschickt.</p>
          <RejectionControls {...rejection} />
          <details className="text-xs text-muted-foreground">
            <summary className="min-h-9 cursor-pointer py-2">Bisherigen Vorschlag ansehen</summary>
            <div className="space-y-2">{segments}</div>
          </details>
        </>}
        {row && <RequestPlanningDetails row={row} />}
      </div>
    </div>
  );
}

interface RejectionControlsProps {
  requestId: string;
  openDays: { date: string; hours: number }[];
  isOpen: boolean;
  draft: string;
  scope: string;
  disabled: boolean;
  isSubmitting: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onDraftChange: (v: string) => void;
  onScopeChange: (v: string) => void;
  onSubmit: () => void;
}

function RejectionControls({ requestId, openDays, isOpen, draft, scope, disabled, isSubmitting, onOpen, onCancel, onDraftChange, onScopeChange, onSubmit }: RejectionControlsProps) {
  const refusalDays = batchRejectionDays(openDays, scope);
  if (!isOpen) return (
    <Button variant="outline" size="sm" onClick={onOpen} disabled={disabled || openDays.length === 0} className="gap-1.5 text-rose-700 border-rose-200 hover:bg-rose-100 dark:text-rose-400 dark:border-rose-900/60 dark:hover:bg-rose-950/40">
      <Ban className="w-3.5 h-3.5" /> Bedarf absagen
    </Button>
  );
  return (
    <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/40 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
      <div className="space-y-1.5">
        <Label htmlFor={`refusal-scope-${requestId}`}>Tage für die Absage</Label>
        <select id={`refusal-scope-${requestId}`} value={scope} disabled={disabled} onChange={event => onScopeChange(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">Alle offenen Tage im Vorschlagszeitraum ({openDays.length})</option>
          {openDays.map(day => <option key={day.date} value={day.date}>{formatShortDay(day.date)} · {day.hours} Std.</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{refusalDays.length} Tag(e) · {refusalDays.reduce((sum, day) => sum + day.hours, 0)} offene Std. Weitere Tage außerhalb dieser Auswahl bleiben bestehen.</p>
      </div>
      <Label htmlFor={`refusal-reason-${requestId}`}>Begründung für die Schule (optional)</Label>
      <Textarea
        id={`refusal-reason-${requestId}`}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value.slice(0, 500))}
        disabled={disabled}
        placeholder="Warum kann dieser Bedarf nicht bedient werden?"
        className="text-sm"
        rows={2}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[11px] text-muted-foreground">{draft.length}/500</span>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>Abbrechen</Button>
          <Button variant="destructive" size="sm" onClick={onSubmit} disabled={disabled || refusalDays.length === 0}>
            {isSubmitting ? "Wird gespeichert…" : "Absage prüfen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UnfillableRow({ entry, row, rejection, deferred = false, onReconsider }: {
  entry: UnfillableEntry; row: RequestRow | undefined; rejection: RejectionControlsProps; deferred?: boolean; onReconsider?: () => void;
}) {
  return (
    <div className={`space-y-3 rounded-xl border p-4 ${deferred ? "border-dashed border-border bg-muted/25" : "border-rose-200 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/20"}`}>
      {row && (
        <div className="space-y-2">
          <h3 className="break-words text-sm font-semibold text-foreground">Zu vertreten: {row.substitutedTeacher || "Nicht angegeben"}{row.className && <span className="font-normal"> · Klasse: {row.className}</span>}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{formatRequestRange(row)} · {requestPriorityLabel(row.priority)}</p>
          <p className={`text-xs font-medium ${deferred ? "text-muted-foreground" : "text-rose-700 dark:text-rose-300"}`}>{row.openDays.reduce((sum, day) => sum + day.hours, 0)} offene Std. im Vorschlagszeitraum</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{deferred ? "Bewusst zurückgestellt. Der Bedarf bleibt offen und wurde nicht abgesagt." : entry.reason}</p>
      <RequestUrgencyNote note={row?.urgencyNote} />
      {deferred && onReconsider && <Button variant="outline" size="sm" disabled={rejection.disabled} onClick={onReconsider} className="mr-2 mb-1 max-w-full">Wieder berücksichtigen</Button>}
      <RejectionControls {...rejection} />
      {row && <RequestPlanningDetails row={row} />}
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
  conflictingSegmentKeys: Set<string>;
  interactionLocked: boolean;
  onApprove: (school: SchoolProposal) => void;
  isApproving: boolean;
  approvedInfo: { requests: number; assignments: number; payload: ApprovalPayload } | undefined;
  openUnfillableId: string | null;
  unfillableDraft: string;
  unfillableScope: string;
  unfillingId: string | null;
  onOpenUnfillable: (requestId: string) => void;
  onCancelUnfillable: () => void;
  onDraftChange: (v: string) => void;
  onScopeChange: (v: string) => void;
  onSubmitUnfillable: (schoolId: string, requestId: string) => void;
  excludedRequestIds?: string[];
  onReconsider?: (requestId: string) => void;
}

export function BatchSchoolCard({
  school,
  requestsById,
  selected,
  onToggle,
  swaps,
  onSwap,
  conflictingSegmentKeys,
  interactionLocked,
  onApprove,
  isApproving,
  approvedInfo,
  openUnfillableId,
  unfillableDraft,
  unfillableScope,
  unfillingId,
  onOpenUnfillable,
  onCancelUnfillable,
  onDraftChange,
  onScopeChange,
  onSubmitUnfillable,
  excludedRequestIds = [],
  onReconsider,
}: SchoolCardProps) {
  const selectedCount = school.proposals.filter(p => selected[p.requestId]).length;
  const selectedSummary = summarizeApproval(school.proposals.filter(p => selected[p.requestId]), swaps);
  const selectedCoverage = school.proposals.filter(p => selected[p.requestId]).reduce(
    (coverage, proposal) => ({ assigned: coverage.assigned + proposal.coverage.assignedHours, required: coverage.required + proposal.coverage.requiredHours, cancelled: coverage.cancelled + (proposal.coverage.cancelledHours ?? 0) }),
    { assigned: 0, required: 0, cancelled: 0 },
  );
  const hasConflicts = school.proposals.some(proposal => selected[proposal.requestId] && proposal.segments.some((_, index) => conflictingSegmentKeys.has(swapKey(proposal.requestId, index))));
  const isDone = approvedInfo !== undefined;
  const approvedRequestIds = new Set(approvedInfo?.payload.items.map(item => item.requestId) ?? []);
  const excludedIds = new Set(excludedRequestIds);
  const unfillable = school.unfillable.filter(entry => !excludedIds.has(entry.requestId));
  const deferred = school.unfillable.filter(entry => excludedIds.has(entry.requestId));
  const representedHours = selectedCoverage.assigned;
  const cancelledHours = selectedCoverage.cancelled;
  const uncoveredHours = Math.max(0, school.coverage.requiredHours - representedHours - cancelledHours);
  const rejectionProps = (requestId: string): RejectionControlsProps => ({
    requestId,
    openDays: requestsById[requestId]?.openDays ?? [],
    isOpen: openUnfillableId === requestId,
    draft: unfillableDraft,
    scope: unfillableScope,
    disabled: interactionLocked || !canRejectBatchRequest(school, requestId, selected, approvedRequestIds),
    isSubmitting: unfillingId === requestId,
    onOpen: () => onOpenUnfillable(requestId),
    onCancel: onCancelUnfillable,
    onDraftChange,
    onScopeChange,
    onSubmit: () => onSubmitUnfillable(school.schoolId, requestId),
  });

  return (
    <Card className="border-border/70 bg-white py-5 dark:bg-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 px-5 pb-4 sm:px-6">
        <div className="min-w-0">
          <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
            {school.schoolName}
            <span className="text-xs font-normal text-muted-foreground">{school.coverage.totalRequests} {school.coverage.totalRequests === 1 ? "Anforderung" : "Anforderungen"}</span>
          </CardTitle>
          <p aria-label="Gesamtabdeckung der Schule" className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span><strong className="font-semibold">{school.coverage.requiredHours} Std.</strong> Bedarf</span>
            <span aria-hidden="true" className="text-muted-foreground">·</span>
            <span className="text-primary"><strong className="font-semibold">{representedHours} Std.</strong> {isDone ? "freigegeben" : "ausgewählt"}</span>
            <span aria-hidden="true" className="text-muted-foreground">·</span>
            <span className={uncoveredHours > 0 ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground"}><strong className="font-semibold">{uncoveredHours} Std.</strong> offen</span>
          </p>
          {cancelledHours > 0 && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{cancelledHours} Reststunden {isDone ? "abgesagt" : "zur Absage bei Freigabe vorgesehen"}.</p>}
          {isDone ? (
            <CardDescription className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium mt-1">
              <CheckCircle2 className="w-4 h-4" /> Freigegeben: {approvedInfo.requests} Anforderung(en), {approvedInfo.assignments} Einsätze
            </CardDescription>
          ) : (
            <CardDescription className="mt-2 text-xs">
              Für Freigabe ausgewählt: {selectedCount} von {school.proposals.length} {school.proposals.length === 1 ? "Vorschlag" : "Vorschlägen"} · {selectedSummary.teachers} {selectedSummary.teachers === 1 ? "Lehrkraft" : "Lehrkräfte"}
            </CardDescription>
          )}
        </div>
        {!isDone && (
          <Button onClick={() => onApprove(school)} disabled={selectedCount === 0 || isApproving || hasConflicts || interactionLocked} className="shrink-0">
              {isApproving ? "Wird freigegeben…" : "Freigeben"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5 px-5 sm:px-6">
        {school.proposals.length > 0 && (
          <div className="space-y-2">
            {hasConflicts && <p role="alert" className="text-xs font-medium text-rose-700 dark:text-rose-300">Freigabe blockiert: Eine Lehrkraft ist im aktuellen Entwurf mehrfach am selben Tag eingeplant.</p>}
            {school.proposals.map(proposal => (
              <RequestProposalRow
                key={proposal.requestId}
                proposal={proposal}
                row={requestsById[proposal.requestId]}
                checked={Boolean(selected[proposal.requestId])}
                onToggle={() => onToggle(proposal.requestId)}
                swaps={swaps}
                onSwap={onSwap}
                conflictingSegmentKeys={conflictingSegmentKeys}
                disabled={isDone || interactionLocked}
                approved={approvedRequestIds.has(proposal.requestId)}
                rejection={rejectionProps(proposal.requestId)}
              />
            ))}
          </div>
        )}

        {unfillable.length > 0 && (
          <div className="space-y-3 border-t border-border/70 pt-5">
            <h4 className="text-xs font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5" /> Nicht besetzbar ({unfillable.length})
            </h4>
            {unfillable.map(entry => (
              <UnfillableRow
                key={entry.requestId}
                entry={entry}
                row={requestsById[entry.requestId]}
                rejection={rejectionProps(entry.requestId)}
              />
            ))}
          </div>
        )}
        {deferred.length > 0 && <div className="space-y-3 border-t border-border/70 pt-5">
          <h4 className="text-xs font-semibold text-muted-foreground">Zurückgestellt ({deferred.length})</h4>
          {deferred.map(entry => <UnfillableRow key={entry.requestId} entry={entry} row={requestsById[entry.requestId]}
            rejection={rejectionProps(entry.requestId)} deferred onReconsider={onReconsider ? () => onReconsider(entry.requestId) : undefined} />)}
        </div>}
      </CardContent>
    </Card>
  );
}

/**
 * Besetzungsvorschläge: Besetzungsvorschlag für ALLE offenen Anforderungen aller Schulen des
 * Schulamts bis zu einem Stichtag auf einen Schlag, statt jede Anforderung einzeln über
 * die Matching Engine zu bearbeiten. Ab- und Zuwahl sowie Lehrkraft-Tausch sind reiner
 * Client-State, bis pro Schule "Freigeben" gedrückt wird - erst dann prüft und speichert
 * der Server (siehe /api/batch-assign/approve).
 */
function schoolYearBounds(schoolYear: string): { start: string; end: string } | null {
  const match = /^(\d{4})\/(\d{4})$/.exec(schoolYear);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  return { start: `${match[1]}-09-01`, end: `${match[2]}-08-31` };
}

function untilForSchoolYear(schoolYear: string): string {
  const bounds = schoolYearBounds(schoolYear);
  if (!bounds) return defaultUntilValue();
  const today = todayDateInputValue();
  if (bounds.end < today) return bounds.end;
  if (bounds.start > today) return bounds.start;
  const preferred = defaultUntilValue();
  return preferred > bounds.end ? bounds.end : preferred;
}

export function BatchAssignView({ schoolYear }: { schoolYear: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [until, setUntil] = useState(() => untilForSchoolYear(schoolYear));
  const [isComputing, setIsComputing] = useState(false);
  const [computeError, setComputeError] = useState("");
  const [hasRun, setHasRun] = useState(false);
  const [data, setData] = useState<PreviewData | null>(null);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [swaps, setSwaps] = useState<SwapState>({});
  const [approvedSchools, setApprovedSchools] = useState<Record<string, { requests: number; assignments: number; payload: ApprovalPayload }>>({});
  const [approvingSchoolId, setApprovingSchoolId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const [openUnfillableId, setOpenUnfillableId] = useState<string | null>(null);
  const [unfillableDraft, setUnfillableDraft] = useState("");
  const [unfillableScope, setUnfillableScope] = useState("all");
  const [unfillingId, setUnfillingId] = useState<string | null>(null);
  const [refusedDaysCount, setRefusedDaysCount] = useState(0);
  const [pendingOvertime, setPendingOvertime] = useState<{ payload: ApprovalPayload; warnings: string[]; generation: number } | null>(null);
  const requestGeneration = useRef(0);
  const planRevision = useRef(0);
  const approvalInFlight = useRef(false);
  const rejectionInFlight = useRef(false);
  const previewAbort = useRef<AbortController | null>(null);

  const yearBounds = schoolYearBounds(schoolYear);
  const isPastSchoolYear = Boolean(yearBounds && yearBounds.end < todayDateInputValue());

  const invalidatePlan = () => {
    requestGeneration.current += 1;
    previewAbort.current?.abort();
    previewAbort.current = null;
    setData(null);
    setHasRun(false);
    setSelected({});
    setSwaps({});
    setApprovedSchools({});
    if (!approvalInFlight.current) setApprovingSchoolId(null);
    setPendingOvertime(null);
    setOpenUnfillableId(null);
    setUnfillableDraft("");
    setUnfillableScope("all");
    setRefusedDaysCount(0);
    setComputeError("");
    if (!rejectionInFlight.current) setUnfillingId(null);
    setIsComputing(false);
    return requestGeneration.current;
  };

  useEffect(() => {
    invalidatePlan();
    setUntil(untilForSchoolYear(schoolYear));
    // A plan belongs to exactly one school year. Changing it must make an old plan
    // impossible to approve, even if its request resolves later.
  }, [schoolYear]);

  useEffect(() => () => {
    // A confirmation dialog can outlive the route that opened it. Its old
    // callback must never submit an invisible plan after navigation.
    requestGeneration.current += 1;
    previewAbort.current?.abort();
  }, []);

  const conflictingSegmentKeys = useMemo(() => data
    ? findTentativeDuplicateTeacherDays(data.schools as BatchPlanSchool[], selected, swaps, Object.values(approvedSchools).map(school => school.payload))
    : new Set<string>(), [data, selected, swaps, approvedSchools]);

  const interactionLocked = isComputing || isConfirming || pendingOvertime !== null || approvingSchoolId !== null || unfillingId !== null;

  const handleCompute = async (preserveSelection = false, reconsiderRequestId?: string) => {
    if (isPastSchoolYear || interactionLocked || rejectionInFlight.current) return;
    if (preserveSelection && conflictingSegmentKeys.size > 0) {
      toast({ variant: "error", title: "Bitte die doppelte Einplanung in Ihrer Auswahl zuerst auflösen." });
      return;
    }
    const payload = preserveSelection && data ? makeRecalculationPayload({
      schools: data.schools, selected, swaps,
      approvedPayloads: Object.values(approvedSchools).map(school => school.payload),
      excludedRequestIds: data.excludedRequestIds, schoolYear, until,
      expectedReserveShortageMode: data.reserveShortageMode, reconsiderRequestId,
    }) : { until, schoolYear };
    // A failed recalculation must not erase a carefully checked selection.
    // Changes to the year/date still invalidate it explicitly above.
    const generation = ++requestGeneration.current;
    previewAbort.current?.abort();
    const controller = new AbortController();
    previewAbort.current = controller;
    setComputeError("");
    setIsComputing(true);
    try {
      const res = await fetch("/api/batch-assign/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await res.json();
      if (generation !== requestGeneration.current) return;
      if (!res.ok) {
        setComputeError(body.error || "Der Vorschlag konnte nicht berechnet werden.");
        return;
      }

      const schools = body.schools as SchoolProposal[];
      const initialSelected: Record<string, boolean> = {};
      for (const school of schools) {
        for (const proposal of school.proposals) initialSelected[proposal.requestId] = true;
      }

      setData({
        schools,
        requestsById: body.requestsById,
        generatedAt: body.generatedAt,
        from: body.from,
        until: body.until,
        schoolYear: body.schoolYear,
        reserveShortageMode: body.reserveShortageMode === true,
        retainedRequestIds: body.retainedRequestIds ?? [],
        excludedRequestIds: body.excludedRequestIds ?? [],
      });
      setSelected(initialSelected);
      setSwaps({});
      setApprovedSchools({});
      setOpenUnfillableId(null);
      setUnfillableDraft("");
      setRefusedDaysCount(0);
      planRevision.current += 1;
      setHasRun(true);
    } catch (error) {
      if (generation === requestGeneration.current && !(error instanceof DOMException && error.name === "AbortError")) {
        setComputeError("Netzwerkfehler. Bitte versuchen Sie es erneut.");
      }
    } finally {
      if (generation === requestGeneration.current) setIsComputing(false);
    }
  };

  const toggleSelected = (requestId: string) => {
    if (interactionLocked || rejectionInFlight.current) return;
    const school = data?.schools.find(candidate => candidate.proposals.some(proposal => proposal.requestId === requestId));
    if (!school || approvedSchools[school.schoolId]) return;
    planRevision.current += 1;
    setPendingOvertime(null);
    setSelected(prev => ({ ...prev, [requestId]: !prev[requestId] }));
    if (openUnfillableId === requestId) setOpenUnfillableId(null);
  };

  const setSwap = (requestId: string, segmentIndex: number, teacherId: string, teacherName: string) => {
    if (interactionLocked || rejectionInFlight.current) return;
    const school = data?.schools.find(candidate => candidate.proposals.some(proposal => proposal.requestId === requestId));
    if (!school || approvedSchools[school.schoolId]) return;
    planRevision.current += 1;
    setPendingOvertime(null);
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
    if (interactionLocked || rejectionInFlight.current || approvedSchools[school.schoolId]) return;
    const selectedProposals = school.proposals.filter(p => selected[p.requestId]);
    if (selectedProposals.length === 0) return;

    if (school.proposals.some(proposal => selected[proposal.requestId] && proposal.segments.some((_, index) => conflictingSegmentKeys.has(swapKey(proposal.requestId, index))))) {
      toast({ variant: "error", title: "Doppelte Einplanung im Entwurf", description: "Bitte wählen Sie eine andere Lehrkraft oder berechnen Sie den Vorschlag neu." });
      return;
    }

    const summary = summarizeApproval(selectedProposals, swaps);
    const confirmationGeneration = requestGeneration.current;
    const confirmationRevision = planRevision.current;
    // Freeze the exact payload before awaiting the dialog. A late state change must
    // never cause a confirmation to submit a different set of assignments.
    const payload = { ...makeApprovalPayload(school, selected, swaps, schoolYear, until), expectedReserveShortageMode: data?.reserveShortageMode === true };
    setIsConfirming(true);
    let confirmed = false;
    try {
      confirmed = await confirm({
        title: `${school.schoolName} freigeben?`,
        description: `${summary.requests} Anforderung(en) für ${summary.teachers} Lehrkraft/Lehrkräfte: ${summary.days} Einsatztag(e), ${summary.hours} Stunden. Termine: ${summary.dateRanges.join(', ')}. Die betroffenen Lehrkräfte werden per E-Mail benachrichtigt.${data?.reserveShortageMode ? " Wegen Reservemangels werden die Reststunden der besetzten Tage abgesagt und der Schule mitgeteilt." : ""}`,
        confirmLabel: "Freigeben",
      });
    } finally {
      setIsConfirming(false);
    }
    if (!confirmed || confirmationGeneration !== requestGeneration.current || confirmationRevision !== planRevision.current) return;

    await submitApproval(payload);
  };

  const submitApproval = async (payload: ApprovalPayload) => {
    if (approvalInFlight.current || rejectionInFlight.current) return;
    const approvalGeneration = requestGeneration.current;
    approvalInFlight.current = true;
    setApprovingSchoolId(payload.schoolId);
    try {
      const res = await fetch("/api/batch-assign/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      const isCurrentPlan = approvalGeneration === requestGeneration.current;

      if (!res.ok) {
        if (!isCurrentPlan) return;
        if (res.status === 409 && body.code === "OVERTIME_CONFIRMATION_REQUIRED" && !payload.allowOvertime) {
          setPendingOvertime({ payload, warnings: Array.isArray(body.warnings) ? body.warnings : [], generation: approvalGeneration });
        } else if (res.status === 409) {
          toast({
            variant: "error",
            title: body.error || "Der Vorschlag ist nicht mehr aktuell.",
            description: "Bitte den Vorschlag oben neu berechnen - es wurde nichts übernommen.",
          });
          invalidatePlan();
        } else {
          toast({ variant: "error", title: body.error || "Die Freigabe konnte nicht durchgeführt werden." });
        }
        return;
      }

      const successWarnings = [
        ...(Array.isArray(body.warnings) ? body.warnings : []),
        ...(Array.isArray(body.notificationWarnings) ? body.notificationWarnings : []),
      ];
      toast({
        variant: successWarnings.length > 0 ? "info" : "success",
        title: successWarnings.length > 0 ? "Freigabe gespeichert – Hinweise prüfen" : "Freigabe gespeichert",
        description: `${successWarnings.join(" ") || `${body.requests} Anforderung(en), ${body.assignments} Einsätze angelegt.`}${isCurrentPlan ? "" : " Der sichtbare Vorschlag wurde inzwischen geändert."}`,
      });
      if (isCurrentPlan) {
        setApprovedSchools(prev => ({ ...prev, [payload.schoolId]: { requests: body.requests, assignments: body.assignments, payload } }));
        setPendingOvertime(null);
      }
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    } finally {
      approvalInFlight.current = false;
      // Even a stale plan must release its in-flight lock. A 409 invalidates
      // the generation above, but must still allow a new calculation.
      setApprovingSchoolId(null);
    }
  };

  const openUnfillable = (requestId: string) => {
    if (interactionLocked || rejectionInFlight.current) return;
    const school = data?.schools.find(candidate => candidate.proposals.some(proposal => proposal.requestId === requestId) || candidate.unfillable.some(entry => entry.requestId === requestId));
    const approvedIds = new Set(school ? approvedSchools[school.schoolId]?.payload.items.map(item => item.requestId) ?? [] : []);
    if (!school || !canRejectBatchRequest(school, requestId, selected, approvedIds)) return;
    setOpenUnfillableId(requestId);
    setUnfillableDraft("");
    setUnfillableScope("all");
  };
  const cancelUnfillable = () => {
    if (interactionLocked || rejectionInFlight.current) return;
    setOpenUnfillableId(null);
    setUnfillableDraft("");
  };

  const submitUnfillable = async (schoolId: string, requestId: string) => {
    if (interactionLocked || rejectionInFlight.current || approvalInFlight.current || !data || openUnfillableId !== requestId) return;
    const school = data.schools.find(candidate => candidate.schoolId === schoolId);
    const row = data.requestsById[requestId];
    const approvedIds = new Set(approvedSchools[schoolId]?.payload.items.map(item => item.requestId) ?? []);
    if (!school || !row || !canRejectBatchRequest(school, requestId, selected, approvedIds)) return;
    const days = batchRejectionDays(row.openDays, unfillableScope);
    if (days.length === 0) return;
    const generation = requestGeneration.current;
    const revision = planRevision.current;
    const dates = days.map(day => day.date);
    const reason = unfillableDraft.trim();
    rejectionInFlight.current = true;
    setIsConfirming(true);
    try {
      const confirmed = await confirm({
        title: `Bedarf für ${row.substitutedTeacher || "die angegebene Lehrkraft"} absagen?`,
        description: `${school.schoolName}: ${days.length} Tag(e), ${days.reduce((sum, day) => sum + day.hours, 0)} offene Stunden. Termine: ${days.map(day => `${new Date(`${day.date}T12:00:00`).toLocaleDateString("de-DE")} (${day.hours} Std.)`).join(", ")}. Die Absage gilt ausschließlich für diese Tage; bestehende Einsätze und weitere Tage bleiben erhalten. Die Schule wird per E-Mail informiert.${reason ? ` Begründung: ${reason}` : ""}`,
        confirmLabel: "Verbindlich absagen",
        variant: "destructive",
      });
      setIsConfirming(false);
      if (!confirmed || generation !== requestGeneration.current || revision !== planRevision.current) return;
      setUnfillingId(requestId);
      const res = await fetch(`/api/requests/${requestId}/unfilled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates, ...(reason ? { reason } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (generation !== requestGeneration.current) return;
        toast({ variant: "error", title: body.error || "Die Absage konnte nicht gespeichert werden." });
        if (res.status === 409) invalidatePlan();
        return;
      }

      toast({
        variant: body.notificationWarning ? "info" : "success",
        title: body.notificationWarning ? "Absage gespeichert – Benachrichtigung prüfen" : "Absage gespeichert",
        description: body.notificationWarnings?.join(" ") || `${days.length} Tag(e) abgesagt. Die Benachrichtigung wurde verarbeitet.`,
      });
      if (generation !== requestGeneration.current) return;
      planRevision.current += 1;
      const remainingDays = row.openDays.filter(day => !dates.includes(day.date));
      setData(prev => prev ? {
        ...prev,
        excludedRequestIds: updateBatchExclusionsAfterRejection(prev.excludedRequestIds, requestId, remainingDays, selected[requestId] === false),
        requestsById: {
          ...prev.requestsById,
          [requestId]: { ...prev.requestsById[requestId], openDays: remainingDays },
        },
        schools: prev.schools.map(school => school.schoolId === schoolId
          ? applyBatchRejection(school, requestId, dates, row.openDays, prev.reserveShortageMode)
          : school),
      } : prev);
      setRefusedDaysCount(count => count + days.length);
      setOpenUnfillableId(null);
      setUnfillableDraft("");
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    } finally {
      rejectionInFlight.current = false;
      setIsConfirming(false);
      setUnfillingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <Card className="border-border/70 bg-white py-5 dark:bg-card">
        <CardHeader className="px-5 pb-4 sm:px-6">
          <CardTitle className="text-xl flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-muted-foreground" /> Besetzungsvorschläge
          </CardTitle>
          <CardDescription>
            Offene Bedarfe bis zum Stichtag planen und anschließend je Schule freigeben.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="idealbesetzung-until">Stichtag</Label>
              <Input
                id="idealbesetzung-until"
                type="date"
                value={until}
                min={yearBounds ? (yearBounds.start > todayDateInputValue() ? yearBounds.start : todayDateInputValue()) : todayDateInputValue()}
                max={yearBounds?.end}
                onChange={(e) => {
                  if (interactionLocked) return;
                  invalidatePlan();
                  planRevision.current += 1;
                  setUntil(e.target.value);
                }}
                disabled={interactionLocked}
                className="w-full sm:w-44"
              />
            </div>
            <Button onClick={() => handleCompute(Boolean(data))} disabled={!until || isPastSchoolYear || interactionLocked} className="h-auto min-h-11 max-w-full whitespace-normal py-2.5">
              {isComputing ? "Wird berechnet…" : data ? "Auswahl behalten & neu berechnen" : "Vorschlag berechnen"}
            </Button>
            {data && <Button variant="ghost" onClick={() => handleCompute(false)} disabled={interactionLocked} className="min-h-11">Alles neu planen</Button>}
          </div>
          {data && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Bei der Neuberechnung bleiben ausgewählte Lehrkräfte und Tage erhalten. Abgewählte Bedarfe werden zurückgestellt. „Alles neu planen“ setzt diese Auswahl zurück.</p>}
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="min-h-9 cursor-pointer py-2">Planungshinweise</summary>
            <p className="max-w-3xl pb-2 leading-relaxed">Die Vorschläge berücksichtigen Dringlichkeit, Abdeckung und möglichst durchgehende Einsätze. Laufende Anforderungen ohne Enddatum werden für die nächsten fünf Arbeitstage geplant, begrenzt durch den Stichtag. Erst „Freigeben“ speichert Einsätze und benachrichtigt die Lehrkräfte.</p>
          </details>
          {isPastSchoolYear && <p role="status" className="mt-3 text-sm text-muted-foreground">Für das vergangene Schuljahr ist keine aktuelle Besetzungsvorschläge möglich. Wechseln Sie zu einem laufenden oder zukünftigen Schuljahr.</p>}
        </CardContent>
      </Card>

      {computeError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
        <p className="font-medium">{computeError}</p>
        {data && <p className="mt-1">Ihre bisherige Auswahl bleibt erhalten. Bitte prüfen Sie den Hinweis und berechnen Sie erneut.</p>}
      </div>}
      {data && (
        <p className="text-xs text-muted-foreground" role="status">
          {data.reserveShortageMode && <span className="block mb-2 font-medium text-amber-800 dark:text-amber-300">Mangel an Reserven ist in den Schulamt-Einstellungen aktiviert: Besetzte Tage werden abgeschlossen; ihre Reststunden werden bei Freigabe abgesagt und der Schule mitgeteilt.</span>}
          Vorschlagszeitraum: {new Date(`${data.from}T12:00:00`).toLocaleDateString("de-DE")} bis {new Date(`${data.until}T12:00:00`).toLocaleDateString("de-DE")} · Schuljahr {data.schoolYear}
          {data.retainedRequestIds.length > 0 && <span className="block mt-1 text-primary">{data.retainedRequestIds.length} {data.retainedRequestIds.length === 1 ? "ausgewählte Anforderung unverändert übernommen" : "ausgewählte Anforderungen unverändert übernommen"}.</span>}
        </p>
      )}

      {hasRun && data && data.schools.length === 0 && (
        <p className="text-muted-foreground italic py-4 text-center">Keine offenen Anforderungen bis zu diesem Stichtag.</p>
      )}

      {data && refusedDaysCount > 0 && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">{refusedDaysCount} Tag(e) abgesagt · Vorschläge neu berechnen</p>
          <p className="mt-1">Mit „Auswahl behalten & neu berechnen“ können freie Reserven anderen Bedarfen vorgeschlagen werden. Absagen lassen sich in der Bedarfsübersicht zurücknehmen.</p>
        </div>
      )}

      {data && data.schools.length > 0 && (
        <div className="space-y-6">
          {data.schools.map(school => (
            <BatchSchoolCard
              key={school.schoolId}
              school={school}
              requestsById={data.requestsById}
              selected={selected}
              onToggle={toggleSelected}
              swaps={swaps}
              onSwap={setSwap}
              conflictingSegmentKeys={conflictingSegmentKeys}
              interactionLocked={interactionLocked}
              onApprove={handleApprove}
              isApproving={approvingSchoolId === school.schoolId}
              approvedInfo={approvedSchools[school.schoolId]}
              openUnfillableId={openUnfillableId}
              unfillableDraft={unfillableDraft}
              unfillableScope={unfillableScope}
              unfillingId={unfillingId}
              onOpenUnfillable={openUnfillable}
              onCancelUnfillable={cancelUnfillable}
              onDraftChange={setUnfillableDraft}
              onScopeChange={setUnfillableScope}
              onSubmitUnfillable={submitUnfillable}
              excludedRequestIds={data.excludedRequestIds}
              onReconsider={requestId => handleCompute(true, requestId)}
            />
          ))}
        </div>
      )}

      <Dialog open={pendingOvertime !== null} onOpenChange={(open) => { if (!open) setPendingOvertime(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-600" /> Mehrarbeit bestätigen</DialogTitle>
            <DialogDescription>Diese Freigabe würde Mehrarbeit auslösen. Es wurde noch nichts gespeichert.</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground" aria-label="Warnungen zur Mehrarbeit">
            {pendingOvertime?.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingOvertime(null)}>Abbrechen</Button>
            <Button
              onClick={() => {
                const pending = pendingOvertime;
                if (!pending || pending.generation !== requestGeneration.current) return;
                setPendingOvertime(null);
                void submitApproval({ ...pending.payload, allowOvertime: true });
              }}
            >Mehrarbeit verbindlich freigeben</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
