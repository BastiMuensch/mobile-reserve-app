import { deploymentSchool } from "@/lib/schoolLocations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, CheckCircle2, Clock, FileText, Loader2, MapPin } from "lucide-react";
import Image from "next/image";
import { AssignmentMapWrapper } from "../AssignmentMapWrapper";
import { AssignmentData, SchoolData } from "@/types/models";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { formatConfirmationDate, getPendingAssignmentConfirmations, getAssignmentDayPlan, isValidDayConfirmation } from "@/lib/assignmentConfirmation";
import { assignmentStartLabel, assignmentLessonHours } from "@/lib/assignmentTiming";
import { requestedDeploymentLabel } from "@/lib/specialistFields";
import { requestedTeachingSchoolType } from "@/lib/matchingSuitability";
import { schoolTypeLabel } from "@/lib/schoolTypes";

export function TeacherNextAssignment({ nextAssignment, assignments }: { nextAssignment: AssignmentData; assignments: AssignmentData[] }) {
  const dayPlan = getAssignmentDayPlan(nextAssignment, assignments);
  const pendingAssignment = dayPlan.find(item => item.status === 'PENDING');
  const totalHours = dayPlan.reduce((sum, item) => sum + item.hours, 0);
  const combined = dayPlan.length > 1;
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
          {new Date(nextAssignment.date).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}
        </Badge>
      </div>

      {pendingAssignment && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/30 dark:bg-amber-900/20">
          <h3 className="text-amber-800 dark:text-amber-400 font-bold mb-1">{combined ? 'Bitte bestätigen Sie die offenen Vertretungsblöcke' : 'Bitte bestätigen Sie diesen Einsatz'}</h3>
          <p className="text-sm text-amber-800/80 dark:text-amber-300/80 mb-3">
            Mit der Bestätigung weiß das Schulamt, dass Sie den Einsatz zur Kenntnis genommen haben.
            Sollten Sie ihn nicht wahrnehmen können, melden Sie sich bitte über &bdquo;Ausfall melden&ldquo;.
          </p>
          <AssignmentConfirmation assignment={pendingAssignment} assignments={assignments} dayAssignments={dayPlan} />
        </div>
      )}

      {!pendingAssignment && dayPlan.every(item => item.status === 'ACCEPTED') && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/30 dark:bg-emerald-900/20">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-emerald-800 dark:text-emerald-300 font-medium">
            {combined ? 'Sie haben alle Vertretungsblöcke dieses Tages bestätigt.' : 'Sie haben diesen Einsatz bestätigt.'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="text-muted-foreground text-xs font-medium mb-1">{combined ? 'Stunden insgesamt' : 'Stunden'}</div>
          <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-orange-500"/> {totalHours} Std.</div>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="text-muted-foreground text-xs font-medium mb-1">Einsatzbeginn</div>
          <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 shrink-0 text-orange-500"/> {assignmentStartLabel(dayPlan[0] ?? nextAssignment)}</div>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="text-muted-foreground text-xs font-medium mb-1">{combined ? 'Vertretungen' : nextAssignment.request?.className ? 'Klasse / Einsatzart' : 'Einsatzart'}</div>
          <div className="font-bold text-lg flex items-center gap-2"><BookOpen className="h-4 w-4 shrink-0 text-orange-500"/><span className="break-words min-w-0">{combined ? `${dayPlan.length} Bedarfe` : <>{nextAssignment.request?.className && `${nextAssignment.request.className} · `}{deploymentLabel(nextAssignment)}</>}</span></div>
        </div>
      </div>

      <AssignmentDayBlocks assignments={dayPlan} />

      {/* School Info & Comments */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border">
        <div className="space-y-4">
          {!combined && nextAssignment.request?.comments && (
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

/** Shows the separate requests so a day confirmation is always reviewable. */
export function AssignmentDayBlocks({ assignments }: { assignments: AssignmentData[] }) {
  return <div className="space-y-2" aria-label="Vertretungsblöcke">
    {assignments.map(item => <div key={item.id} className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{lessonLabel(item)} · {item.hours} Std.</strong>
        <span className={item.status === 'ACCEPTED' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>{item.status === 'ACCEPTED' ? 'Bestätigt' : 'Bestätigung offen'}</span>
      </div>
      <p>Vertretung für {item.request?.substitutedTeacher || 'nicht angegeben'}{item.request?.className && ` · Klasse ${item.request.className}`}</p>
      <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Einsatzart</dt><dd className="break-words font-medium">{deploymentLabel(item)}</dd></div>
        {item.request?.gradeLevel != null && <div><dt className="text-xs text-muted-foreground">Jahrgangsstufe</dt><dd className="font-medium">{item.request.gradeLevel}</dd></div>}
        {item.request?.requiredSubject && <div className="min-w-0"><dt className="text-xs text-muted-foreground">Fach</dt><dd className="break-words font-medium">{item.request.requiredSubject}</dd></div>}
      </dl>
      {assignments.length > 1 && item.request?.comments && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{item.request.comments}</p>}
    </div>)}
  </div>;
}

function deploymentLabel(assignment: AssignmentData): string {
  const request = assignment.request;
  if (!request) return 'Nicht angegeben';
  return requestedDeploymentLabel(request)
    ?? schoolTypeLabel(requestedTeachingSchoolType(request) ?? request.schoolType);
}

function lessonLabel(assignment: AssignmentData): string {
  const slots = assignmentLessonHours(assignment);
  if (!slots) return assignmentStartLabel(assignment);
  const consecutive = slots.every((hour, index) => index === 0 || hour === slots[index - 1] + 1);
  return consecutive && slots.length > 1
    ? `${slots[0]}.–${slots[slots.length - 1]}. Stunde`
    : `${slots.map(hour => `${hour}.`).join(', ')} Stunde`;
}

/** Explicit IDs cover only the displayed day blocks or the displayed request series. */
export function AssignmentConfirmation({ assignment, assignments, dayAssignments, compact = false }: {
  assignment: AssignmentData;
  assignments: AssignmentData[];
  dayAssignments?: AssignmentData[];
  compact?: boolean;
}) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const { toast } = useToast();
  const pending = getPendingAssignmentConfirmations(assignment, assignments);
  const dayPlan = dayAssignments ?? getAssignmentDayPlan(assignment, assignments);
  const dayPending = dayPlan.filter(item => item.status === 'PENDING');
  const hasDayGroup = dayPlan.length > 1 && isValidDayConfirmation(assignment, dayPlan);
  const hasSeries = pending.length > 1;
  const seriesTeacher = assignment.request?.substitutedTeacher || 'die gemeldete Lehrkraft';

  async function confirm(selected: AssignmentData[], scope: 'DAY' | 'REQUEST' = 'REQUEST') {
    if (isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      const res = await fetch(`/api/assignments/${assignment.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ACCEPTED", assignmentIds: selected.map(item => item.id), scope }),
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "error", title: "Einsatz konnte nicht bestätigt werden.", description: body.error });
        if (res.status === 409) window.dispatchEvent(new Event("app-refresh"));
        return;
      }
      const title = body.alreadyAccepted ? "Bereits bestätigt." : body.confirmedCount > 1
        ? `${body.confirmedCount} ${scope === 'DAY' ? 'Vertretungsblöcke' : 'Einsatztage'} bestätigt.` : "Einsatz bestätigt.";
      toast({ variant: body.notificationWarning ? "info" : "success", title, description: body.notificationWarnings?.join(" ") });
      window.dispatchEvent(new Event("app-refresh"));
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler.", description: "Bitte versuchen Sie es erneut." });
    } finally { setIsUpdatingStatus(false); }
  }

  return <div className="space-y-2">
    {hasDayGroup && <p className="text-sm text-muted-foreground">
      {dayPending.length} {dayPending.length === 1 ? 'offener Vertretungsblock' : 'offene Vertretungsblöcke'} am {formatConfirmationDate(assignment.date)} mit {dayPending.reduce((sum, item) => sum + item.hours, 0)} Std. werden bestätigt.
    </p>}
    {hasSeries && <p className="text-sm text-muted-foreground">
      Vertretung für {seriesTeacher}{assignment.request?.className && ` · Klasse ${assignment.request.className}`}:
      {' '}{pending.length} offene Einsatztage mit insgesamt {pending.reduce((sum, item) => sum + item.hours, 0)} Std., {formatConfirmationDate(pending[0].date)} bis {formatConfirmationDate(pending[pending.length - 1].date)}.
      {!compact && " Sie können alle bereits zugewiesenen Tage gemeinsam bestätigen."}
    </p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" className="h-auto min-h-9 whitespace-normal" disabled={isUpdatingStatus} onClick={() => void confirm(hasDayGroup ? dayPending : hasSeries ? pending : [assignment], hasDayGroup ? 'DAY' : 'REQUEST')}>
        {isUpdatingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {isUpdatingStatus ? "Wird verarbeitet..." : hasDayGroup ? (dayPending.length > 1 ? `Alle ${dayPending.length} Vertretungsblöcke bestätigen` : 'Offenen Vertretungsblock bestätigen') : hasSeries ? `Alle ${pending.length} Einsatztage bestätigen` : compact ? "Bestätigen" : "Hier bestätigen"}
      </Button>
      {hasDayGroup && hasSeries && <Button type="button" variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={isUpdatingStatus} onClick={() => void confirm(pending)}>
        Alle {pending.length} Tage für {seriesTeacher} bestätigen
      </Button>}
      {!hasDayGroup && hasSeries && <Button type="button" variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={isUpdatingStatus} onClick={() => void confirm([assignment])}>
        Nur {formatConfirmationDate(assignment.date)} bestätigen
      </Button>}
    </div>
  </div>;
}
