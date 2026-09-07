import { Badge } from "@/components/ui/badge";
import { BookOpen, CheckCircle2, Clock, FileText, MapPin } from "lucide-react";
import Image from "next/image";
import { AssignmentMapWrapper } from "../AssignmentMapWrapper";
import { AssignmentData, SchoolData } from "@/types/models";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

export function TeacherNextAssignment({ nextAssignment }: { nextAssignment: AssignmentData }) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const { toast } = useToast();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-foreground">{nextAssignment.request?.school.name}</h2>
          <p className="text-muted-foreground flex items-center gap-1 mt-1">
            <MapPin className="h-4 w-4" /> {nextAssignment.request?.school.address}
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
          <button
            type="button"
            disabled={isUpdatingStatus}
            onClick={async () => {
              if (isUpdatingStatus) return;
              setIsUpdatingStatus(true);
              try {
                const res = await fetch(`/api/assignments/${nextAssignment.id}/status`, {
                  method: 'PATCH', body: JSON.stringify({status: 'ACCEPTED'}), headers: {'Content-Type': 'application/json'}
                });
                if (!res.ok) {
                  const err = await res.json();
                  toast({ variant: "error", title: "Einsatz konnte nicht bestätigt werden.", description: err.error });
                  return;
                }
                const body = await res.json();
                toast({
                  variant: body.notificationWarning ? "info" : "success",
                  title: body.notificationWarning ? "Einsatz bestätigt – Benachrichtigung prüfen" : "Einsatz bestätigt.",
                  description: body.notificationWarnings?.join(" "),
                });
                window.dispatchEvent(new Event('app-refresh'));
              } catch {
                toast({ variant: "error", title: "Netzwerkfehler.", description: "Bitte versuchen Sie es erneut." });
              } finally {
                setIsUpdatingStatus(false);
              }
            }}
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            {isUpdatingStatus ? 'Wird verarbeitet...' : 'Hier bestätigen'}
          </button>
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
              {nextAssignment.request?.school.generalInfo ? (
                <div className="text-foreground whitespace-pre-wrap">{nextAssignment.request?.school.generalInfo}</div>
              ) : (
                <div className="text-muted-foreground italic">Die Schule hat noch keine allgemeinen Informationen hinterlegt (z.B. wo Sie sich morgens melden sollen).</div>
              )}
              {nextAssignment.request?.school.imageUrl && (
                <div className="mt-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schul-Foto</span>
                  <div className="mt-1 relative h-32 w-full rounded-md overflow-hidden">
                    <Image src={nextAssignment.request.school.imageUrl} alt="Schule" fill className="object-cover" />
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
          <AssignmentMapWrapper school={nextAssignment.request?.school as SchoolData} />
        </div>
      </div>
    </div>
  );
}
