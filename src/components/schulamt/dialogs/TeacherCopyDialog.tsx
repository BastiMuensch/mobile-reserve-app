"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type OngoingLeavePeriod = {
  id: string;
  startDate: string;
  endDate: string | null;
  reportedBy: string;
};

type CopyCandidate = {
  id: string;
  name: string;
  email: string | null;
  schoolName: string;
  sourceStatus: string;
  targetStatus: "ACTIVE";
  alreadyExists: boolean;
  skipReason: string | null;
  selectedByDefault: boolean;
  ongoingLeavePeriods: OngoingLeavePeriod[];
};

type CopyPreview = {
  sourceYears: string[];
  sourceYear: string | null;
  targetYear: string;
  candidates: CopyCandidate[];
};

type CopyResult = {
  copied: number;
  skipped: number;
  leavesCopied: number;
};

// The API enforces the same limit. Larger selections are sent sequentially so
// each serializable database transaction remains short and independently
// retryable.
const COPY_BATCH_SIZE = 500;

interface TeacherCopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetYear: string;
  onSuccess: (result: CopyResult) => void;
}

function isCandidateAvailable(candidate: CopyCandidate) {
  return !candidate.alreadyExists && candidate.sourceStatus !== "PENDING" && !candidate.skipReason;
}

function candidateDisabledReason(candidate: CopyCandidate) {
  if (candidate.alreadyExists) return candidate.skipReason || "Im Zieljahr bereits vorhanden.";
  if (candidate.sourceStatus === "PENDING") return candidate.skipReason || "Registrierung noch nicht freigegeben.";
  return candidate.skipReason;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "ungültiges Datum"
    : new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin" }).format(date);
}

function inBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    batches.push(items.slice(start, start + batchSize));
  }
  return batches;
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      id="copy-all-teachers"
      type="checkbox"
      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

export function TeacherCopyDialog({ open, onOpenChange, targetYear, onSuccess }: TeacherCopyDialogProps) {
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [sourceYear, setSourceYear] = useState<string | null>(null);
  const [requestedSourceYear, setRequestedSourceYear] = useState<string | undefined>();
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<string>>(new Set());
  const [copyLeaveTeacherIds, setCopyLeaveTeacherIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [submitProgress, setSubmitProgress] = useState<{ current: number; total: number } | null>(null);
  const submitAbortRef = useRef<AbortController | null>(null);
  const submissionRunRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    const loadPreview = async () => {
      setIsLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ targetYear });
        if (requestedSourceYear) params.set("sourceYear", requestedSourceYear);
        const response = await fetch(`/api/teachers/copy?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null) as CopyPreview | { error?: string } | null;
        if (!response.ok || !result || !("candidates" in result)) {
          throw new Error(result && "error" in result && result.error ? result.error : "Die Vorschau konnte nicht geladen werden.");
        }

        setPreview(result);
        setSourceYear(result.sourceYear);
        const defaultTeachers = result.candidates
          .filter(candidate => isCandidateAvailable(candidate) && candidate.selectedByDefault)
          .map(candidate => candidate.id);
        setSelectedTeacherIds(new Set(defaultTeachers));
        setCopyLeaveTeacherIds(new Set(
          result.candidates
            .filter(candidate => isCandidateAvailable(candidate) && candidate.ongoingLeavePeriods.length > 0)
            .map(candidate => candidate.id),
        ));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setPreview(null);
        setError(caught instanceof Error ? caught.message : "Die Vorschau konnte nicht geladen werden.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void loadPreview();
    return () => controller.abort();
  }, [open, reloadToken, requestedSourceYear, targetYear]);

  const resetDialog = () => {
    setPreview(null);
    setSourceYear(null);
    setRequestedSourceYear(undefined);
    setSelectedTeacherIds(new Set());
    setCopyLeaveTeacherIds(new Set());
    setError("");
    setNotice("");
    setSubmitProgress(null);
  };

  useEffect(() => {
    // A parent can close this controlled dialog without going through our
    // handler. Resetting on every close guarantees the next opening never
    // inherits a failed preview or an old selection.
    if (!open) resetDialog();
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSubmitting) {
      // Aborting the browser request cannot forcibly roll back an already
      // running server transaction. The next preview is authoritative and
      // prevents duplicate copies if it completed in the meantime.
      submissionRunRef.current += 1;
      submitAbortRef.current?.abort();
      submitAbortRef.current = null;
      setIsSubmitting(false);
    }
    if (!nextOpen) resetDialog();
    onOpenChange(nextOpen);
  };

  const availableCandidates = useMemo(
    () => preview?.candidates.filter(isCandidateAvailable) ?? [],
    [preview],
  );
  const selectedAvailableCount = availableCandidates.filter(candidate => selectedTeacherIds.has(candidate.id)).length;
  const allAvailableSelected = availableCandidates.length > 0 && selectedAvailableCount === availableCandidates.length;
  const someAvailableSelected = selectedAvailableCount > 0 && !allAvailableSelected;
  const selectedLeaveCount = availableCandidates
    .filter(candidate => selectedTeacherIds.has(candidate.id) && copyLeaveTeacherIds.has(candidate.id))
    .reduce((sum, candidate) => sum + candidate.ongoingLeavePeriods.length, 0);

  const toggleTeacher = (teacherId: string, checked: boolean) => {
    setSelectedTeacherIds(previous => {
      const next = new Set(previous);
      if (checked) next.add(teacherId);
      else next.delete(teacherId);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedTeacherIds(checked ? new Set(availableCandidates.map(candidate => candidate.id)) : new Set());
  };

  const toggleLeaves = (teacherId: string, checked: boolean) => {
    setCopyLeaveTeacherIds(previous => {
      const next = new Set(previous);
      if (checked) next.add(teacherId);
      else next.delete(teacherId);
      return next;
    });
  };

  const submit = async () => {
    if (!sourceYear || selectedAvailableCount === 0) return;
    setIsSubmitting(true);
    setError("");
    setNotice("");
    const run = submissionRunRef.current + 1;
    submissionRunRef.current = run;
    const controller = new AbortController();
    submitAbortRef.current = controller;
    let copied = 0;
    let skipped = 0;
    let leavesCopied = 0;
    try {
      const teacherIds = availableCandidates
        .filter(candidate => selectedTeacherIds.has(candidate.id))
        .map(candidate => candidate.id);
      const batches = inBatches(teacherIds, COPY_BATCH_SIZE);

      for (const [index, batchTeacherIds] of batches.entries()) {
        if (controller.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
        setSubmitProgress({ current: index + 1, total: batches.length });
        const timeout = window.setTimeout(() => controller.abort(), 30_000);
        try {
          const response = await fetch("/api/teachers/copy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              sourceYear,
              targetYear,
              teacherIds: batchTeacherIds,
              copyLeaveTeacherIds: batchTeacherIds.filter(id => copyLeaveTeacherIds.has(id)),
            }),
          });
          const result = await response.json().catch(() => null) as CopyResult | { error?: string } | null;
          if (!response.ok || !result || !("copied" in result)) {
            throw new Error(result && "error" in result && result.error ? result.error : "Die Lehrkräfte konnten nicht übernommen werden.");
          }
          copied += result.copied;
          skipped += result.skipped;
          leavesCopied += result.leavesCopied;
        } finally {
          window.clearTimeout(timeout);
        }
      }

      if (run !== submissionRunRef.current) return;
      const result = { copied, skipped, leavesCopied };
      if (result.copied === 0) {
        setNotice("Es wurde keine weitere Lehrkraft übernommen. Die Vorschau wurde aktualisiert; möglicherweise waren alle ausgewählten Lehrkräfte bereits im Zieljahr vorhanden.");
        setReloadToken(value => value + 1);
        return;
      }

      resetDialog();
      onOpenChange(false);
      onSuccess(result);
    } catch (caught) {
      if (run !== submissionRunRef.current) return;
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "Die Übernahme wurde abgebrochen oder hat länger als 30 Sekunden pro Stapel gedauert. Bitte Vorschau aktualisieren und erneut versuchen."
          : caught instanceof Error ? caught.message : "Die Lehrkräfte konnten nicht übernommen werden.",
      );
      if (copied > 0) {
        setNotice(`${copied} Lehrkraft${copied === 1 ? " wurde" : "e wurden"} bereits übernommen. Die Vorschau wird aktualisiert, damit nur die verbleibende Auswahl erneut gesendet wird.`);
        setReloadToken(value => value + 1);
      }
    } finally {
      if (run === submissionRunRef.current) {
        submitAbortRef.current = null;
        setSubmitProgress(null);
        setIsSubmitting(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Lehrkräfte übernehmen</DialogTitle>
          <DialogDescription>
            Wählen Sie aus, welche mobilen Reserven in das Schuljahr {targetYear} übernommen werden sollen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="copy-source-year">Quellschuljahr</Label>
            <Select
              value={sourceYear ?? ""}
              onValueChange={value => {
                if (!value) return;
                setSourceYear(value);
                setRequestedSourceYear(value);
              }}
              disabled={isLoading || isSubmitting || !preview?.sourceYears.length}
            >
              <SelectTrigger id="copy-source-year" className="w-full">
                <SelectValue placeholder="Quellschuljahr auswählen" />
              </SelectTrigger>
              <SelectContent>
                {preview?.sourceYears.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {isLoading && (
              <p className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" /> Lehrkräfte werden geladen …
              </p>
            )}
            {error && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{error}</span>
                {!isSubmitting && (
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    setReloadToken(value => value + 1);
                  }}>
                    <RefreshCw className="h-3.5 w-3.5" /> Erneut laden
                  </Button>
                )}
              </div>
            )}
            {notice && (
              <p className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary" role="status">
                {notice}
              </p>
            )}
          </div>

          {!isLoading && preview && (
            <>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <p className="font-medium">Status im Zieljahr: Aktiv</p>
                <p className="mt-1 text-muted-foreground">Übernommene Lehrkräfte starten im Zieljahr immer mit dem Status „Aktiv“. Offene Registrierungen werden nicht übernommen.</p>
              </div>

              <div className="flex items-start gap-3 rounded-lg border p-3">
                <SelectAllCheckbox
                  checked={allAvailableSelected}
                  indeterminate={someAvailableSelected}
                  disabled={availableCandidates.length === 0 || isSubmitting}
                  onChange={toggleAll}
                />
                <Label htmlFor="copy-all-teachers" className="cursor-pointer leading-snug">
                  Alle verfügbaren Lehrkräfte auswählen ({availableCandidates.length})
                </Label>
              </div>

              <div className="space-y-3" role="group" aria-label="Lehrkräfte für die Übernahme auswählen">
                {preview.candidates.length === 0 && (
                  <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Im gewählten Quellschuljahr wurden keine Lehrkräfte gefunden.</p>
                )}
                {preview.candidates.map(candidate => {
                  const disabledReason = candidateDisabledReason(candidate);
                  const disabled = !isCandidateAvailable(candidate);
                  const teacherInputId = `copy-teacher-${candidate.id}`;
                  const leavesInputId = `copy-leaves-${candidate.id}`;
                  const selected = selectedTeacherIds.has(candidate.id);

                  return (
                    <article key={candidate.id} className={`rounded-xl border p-4 ${disabled ? "bg-muted/40 opacity-75" : "bg-card"}`}>
                      <div className="flex items-start gap-3">
                        <input
                          id={teacherInputId}
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 accent-primary"
                          checked={selected}
                          disabled={disabled || isSubmitting}
                          onChange={event => toggleTeacher(candidate.id, event.target.checked)}
                          aria-describedby={disabledReason ? `${teacherInputId}-reason` : undefined}
                        />
                        <div className="min-w-0 flex-1">
                          <Label htmlFor={teacherInputId} className={disabled ? "cursor-not-allowed" : "cursor-pointer"}>
                            <span className="break-words">{candidate.name}</span>
                          </Label>
                          <p className="mt-1 break-words text-xs text-muted-foreground">
                            {candidate.schoolName}{candidate.email ? ` · ${candidate.email}` : ""}
                          </p>
                          {disabledReason && (
                            <p id={`${teacherInputId}-reason`} className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {disabledReason}
                            </p>
                          )}

                          {candidate.ongoingLeavePeriods.length > 0 && (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">Laufende Langzeitabwesenheit</p>
                              <ul className="mt-1 space-y-1 text-xs text-amber-800 dark:text-amber-300">
                                {candidate.ongoingLeavePeriods.map(period => (
                                  <li key={period.id}>
                                    {formatDate(period.startDate)} bis {period.endDate ? formatDate(period.endDate) : "auf Weiteres"}
                                  </li>
                                ))}
                              </ul>
                              <div className="mt-3 flex items-start gap-2">
                                <input
                                  id={leavesInputId}
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                  checked={copyLeaveTeacherIds.has(candidate.id)}
                                  disabled={disabled || !selected || isSubmitting}
                                  onChange={event => toggleLeaves(candidate.id, event.target.checked)}
                                />
                                <Label htmlFor={leavesInputId} className="cursor-pointer text-xs leading-snug">
                                  Laufende Langzeitabwesenheit ebenfalls übernehmen
                                </Label>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="rounded-xl border bg-muted/30 p-4" aria-live="polite">
                <p className="font-medium">Zusammenfassung</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedAvailableCount} {selectedAvailableCount === 1 ? "Lehrkraft" : "Lehrkräfte"} werden von {sourceYear ?? "–"} nach {targetYear} übernommen.
                  {selectedLeaveCount > 0 ? ` Zusätzlich werden ${selectedLeaveCount} laufende Langzeitabwesenheit${selectedLeaveCount === 1 ? "" : "en"} übernommen.` : " Es werden keine Langzeitabwesenheiten übernommen."}
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {isSubmitting ? "Übernahme abbrechen" : "Abbrechen"}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={isLoading || isSubmitting || !sourceYear || selectedAvailableCount === 0}>
            {isSubmitting ? <><Loader2 className="animate-spin" /> Übernahme läuft{submitProgress ? ` (${submitProgress.current}/${submitProgress.total})` : ""} …</> : <><CheckCircle2 /> Auswahl bestätigen und übernehmen</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
