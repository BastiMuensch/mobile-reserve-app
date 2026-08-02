"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CalendarOff, Trash2 } from "lucide-react";
import { formatLeaveRange } from "@/lib/leave";
import { LeavePeriodData } from "@/types/models";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface LeavePeriodManagerProps {
  /** Nur für das Schulamt: Lehrkraft, für die eingetragen wird. Lehrkräfte melden für sich selbst. */
  teacherId?: string;
  /** Wird nach jeder Änderung aufgerufen, damit das Dashboard neu laden kann. */
  onChanged?: () => void;
}

/**
 * Liste und Eingabe längerer Abwesenheiten. Wird sowohl im Schulamts-Dialog als auch
 * im Dashboard der Lehrkraft verwendet – die Rolle entscheidet serverseitig darüber,
 * für wen eingetragen werden darf (siehe src/app/api/teachers/leave/route.ts).
 *
 * Erfasst wird ausschließlich der Zeitraum. Es gibt bewusst kein Feld für den Grund:
 * Mutterschutz oder eine Erkrankung sind Gesundheitsdaten nach Art. 9 DSGVO und werden
 * auf dem üblichen Dienstweg gemeldet, nicht hier gespeichert.
 */
export function LeavePeriodManager({ teacherId, onChanged }: LeavePeriodManagerProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [periods, setPeriods] = useState<LeavePeriodData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [startDate, setStartDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState("");
  const [openEnded, setOpenEnded] = useState(false);

  const query = teacherId ? `?teacherId=${encodeURIComponent(teacherId)}` : "";

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/teachers/leave${query}${query ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) setPeriods(await res.json());
    } catch {
      toast({ variant: "error", title: "Die Abwesenheiten konnten nicht geladen werden." });
    } finally {
      setIsLoading(false);
    }
  }, [query, toast]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setStartDate(new Date().toISOString().split("T")[0]);
    setEndDate("");
    setOpenEnded(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openEnded && !endDate) {
      toast({ variant: "error", title: "Bitte ein Ende angeben oder „bis auf Weiteres“ wählen." });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/teachers/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(teacherId ? { teacherId } : {}),
          startDate,
          endDate: openEnded ? null : endDate,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast({ variant: "error", title: body.error || "Der Zeitraum konnte nicht gespeichert werden." });
        return;
      }

      toast({
        variant: "success",
        title: "Abwesenheit gespeichert",
        description: body.cancelledAssignments > 0
          ? `${body.cancelledAssignments} geplante Einsätze in diesem Zeitraum wurden storniert und die Anforderungen wieder geöffnet.`
          : "Es lagen keine geplanten Einsätze in diesem Zeitraum.",
      });
      resetForm();
      await load();
      onChanged?.();
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (period: LeavePeriodData) => {
    const ok = await confirm({
      title: "Zeitraum löschen?",
      description: `Die Abwesenheit ${formatLeaveRange(period.startDate, period.endDate)} wird entfernt. Bereits stornierte Einsätze bleiben storniert.`,
      confirmLabel: "Löschen",
      variant: "destructive",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/teachers/leave/${period.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        toast({ variant: "error", title: body.error || "Der Zeitraum konnte nicht gelöscht werden." });
        return;
      }
      await load();
      onChanged?.();
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isRunning = (p: LeavePeriodData) =>
    new Date(p.startDate) <= today && (!p.endDate || new Date(p.endDate) >= today);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Erfasste Zeiträume</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Wird geladen…</p>
        ) : periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bisher ist keine längere Abwesenheit erfasst.</p>
        ) : (
          <ul className="space-y-2">
            {periods.map(period => (
              <li
                key={period.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-3"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-medium text-foreground">
                    {formatLeaveRange(period.startDate, period.endDate)}
                  </span>
                  {isRunning(period) && (
                    <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400">
                      läuft
                    </Badge>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Zeitraum ${formatLeaveRange(period.startDate, period.endDate)} löschen`}
                  onClick={() => handleDelete(period)}
                  className="text-muted-foreground hover:text-rose-600 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 border-t border-border/60 pt-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <CalendarOff className="h-4 w-4 text-primary" /> Neuen Zeitraum eintragen
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="leave-start">Beginn</Label>
            <Input
              id="leave-start"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="leave-end">Ende</Label>
            <Input
              id="leave-end"
              type="date"
              value={endDate}
              min={startDate}
              onChange={e => setEndDate(e.target.value)}
              disabled={openEnded}
              required={!openEnded}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={openEnded}
            onChange={e => { setOpenEnded(e.target.checked); if (e.target.checked) setEndDate(""); }}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          Ende noch offen (bis auf Weiteres)
        </label>

        <div className="rounded-xl border border-border/60 bg-muted/50 p-3 text-xs text-muted-foreground space-y-1.5">
          <p>
            <strong className="text-foreground">Kein Grund erforderlich.</strong> Erfasst wird nur
            der Zeitraum. Den Grund melden Sie wie gewohnt per Dienst-E-Mail oder telefonisch –
            er wird in dieser Anwendung bewusst nicht gespeichert.
          </p>
          <p>
            Bereits geplante Einsätze in diesem Zeitraum werden storniert; die betroffenen
            Anforderungen stehen danach wieder zur Besetzung bereit.
          </p>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Wird gespeichert…" : "Zeitraum eintragen"}
          </Button>
        </div>
      </form>
    </div>
  );
}
