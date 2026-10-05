import { deploymentSchool } from "@/lib/schoolLocations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, CheckCircle2, Clock, FileText, Loader2, MapPin } from "lucide-react";
import Image from "next/image";
import { AssignmentMapWrapper } from "../AssignmentMapWrapper";
import { AssignmentData, SchoolData } from "@/types/models";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { formatConfirmationDate, getPendingAssignmentConfirmations } from "@/lib/assignmentConfirmation";

export function TeacherNextAssignment({ nextAssignment, assignments }: { nextAssignment: AssignmentData; assignments: AssignmentData[] }) {
  const school = nextAssignment.request ? deploymentSchool(nextAssignment.request.school, nextAssignment.request.location) : undefined;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-bold tracking-tight text-foreground">{school?.name}</h2>
          <p className="text-muted-foreground flex items-center gap-1 mt-1">
            <MapPin className="h-4 w-4" /> {school?.address}
          </p>
        </div>
        <Badge className="w-fit border border-amber-200 bg-amber-50 px-2.5 py-1 text-sm text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25">
          {new Date(nextAssignment.date).toLocaleDateString('de-DE')}
        </Badge>
      </div>

      {nextAssignment.status === 'PENDING' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/30 dark:bg-amber-900/20">
          <h3 className="text-amber-800 dark:text-amber-400 font-bold mb-1">Bitte bestätigen Sie diesen Einsatz</h3>
          <p className="text-sm text-amber-800/80 dark:text-amber-300/80 mb-3">
            Mit der Bestätigung weiß das Schulamt, dass Sie den Einsatz zur Kenntnis genommen haben.
            Sollten Sie ihn nicht wahrnehmen können, melden Sie sich bitte über &bdquo;Ausfall melden&ldquo;.
          </p>
          <AssignmentConfirmation assignment={nextAssignment} assignments={assignments} />
        </div>
      )}

      {nextAssignment.status === 'ACCEPTED' && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/30 dark:bg-emerald-900/20">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-emerald-800 dark:text-emerald-300 font-medium">
            Sie haben diesen Einsatz bestätigt.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="text-muted-foreground text-xs font-medium mb-1">Stunden</div>
          <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-orange-500"/> {nextAssignment.hours} Std.</div>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="text-muted-foreground text-xs font-medium mb-1">Ab Stunde</div>
          <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-orange-500"/> {nextAssignment.request?.startHour}. Std</div>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="text-muted-foreground text-xs font-medium mb-1">Klasse / Schulart</div>
          <div className="font-bold text-lg flex items-center gap-2"><BookOpen className="h-4 w-4 text-orange-500"/> {nextAssignment.request?.schoolType === 'GRUNDSCHULE' ? 'GS' : nextAssignment.request?.schoolType === 'MITTELSCHULE' ? 'MS' : 'GS/MS'}</div>
        </div>
      </div>

      {/* School Info & Comments */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border">
        <div className="space-y-4">
          {nextAssignment.request?.comments && (
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-primary" />
                Bemerkungen zum Einsatz
              </h3>
              <p className="text-sm bg-muted p-3 rounded-lg border border-border text-muted-foreground">
                {nextAssignment.request?.comments}
              </p>
            </div>
          )}

          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Informationen zur Schule
            </h3>
            <div className="bg-primary/5 p-3 rounded-lg border border-primary/15 text-sm">
              {school?.generalInfo ? (
                <div className="text-foreground whitespace-pre-wrap">{school?.generalInfo}</div>
              ) : (
                <div className="text-muted-foreground italic">Die Schule hat noch keine allgemeinen Informationen hinterlegt (z.B. wo Sie sich morgens melden sollen).</div>
              )}
              {school?.imageUrl && (
                <div className="mt-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schul-Foto</span>
                  <div className="mt-1 relative h-32 w-full rounded-md overflow-hidden">
                    <Image src={school.imageUrl} alt="Schule" fill className="object-cover" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-2">
            <MapPin className="h-4 w-4 text-primary" />
            Anfahrt & Parkplatz
          </h3>
          <AssignmentMapWrapper school={school as SchoolData} />
        </div>
      </div>
    </div>
  );
}

/** Reused in the upcoming list so every pending request can be confirmed at once. */
export function AssignmentConfirmation({ assignment, assignments, compact = false }: {
  assignment: AssignmentData;
  assignments: AssignmentData[];
  compact?: boolean;
}) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const { toast } = useToast();
  const pending = getPendingAssignmentConfirmations(assignment, assignments);
  const hasSeries = pending.length > 1;

  async function confirm(allDays: boolean) {
    if (isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      const res = await fetch(`/api/assignments/${assignment.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ACCEPTED", ...(allDays ? { assignmentIds: pending.map(item => item.id) } : {}) }),
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "error", title: "Einsatz konnte nicht bestätigt werden.", description: body.error });
        if (res.status === 409) window.dispatchEvent(new Event("app-refresh"));
        return;
      }
      const title = body.alreadyAccepted ? "Bereits bestätigt." : body.confirmedCount > 1 ? `${body.confirmedCount} Einsatztage bestätigt.` : "Einsatz bestätigt.";
      toast({ variant: body.notificationWarning ? "info" : "success", title, description: body.notificationWarnings?.join(" ") });
      window.dispatchEvent(new Event("app-refresh"));
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler.", description: "Bitte versuchen Sie es erneut." });
    } finally { setIsUpdatingStatus(false); }
  }

  return <div className="space-y-2">
    {hasSeries && <p className="text-sm text-muted-foreground">
      {pending.length} offene Einsatztage für diese Anforderung: {formatConfirmationDate(pending[0].date)} bis {formatConfirmationDate(pending[pending.length - 1].date)}.
      {!compact && " Sie können alle bereits zugewiesenen Tage gemeinsam bestätigen."}
    </p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" className="h-auto min-h-9 whitespace-normal" disabled={isUpdatingStatus} onClick={() => void confirm(hasSeries)}>
        {isUpdatingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {isUpdatingStatus ? "Wird verarbeitet..." : hasSeries ? `Alle ${pending.length} Einsatztage bestätigen` : compact ? "Bestätigen" : "Hier bestätigen"}
      </Button>
      {hasSeries && <Button type="button" variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={isUpdatingStatus} onClick={() => void confirm(false)}>
        Nur {formatConfirmationDate(assignment.date)} bestätigen
      </Button>}
    </div>
  </div>;
}
