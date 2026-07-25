import { Badge } from "@/components/ui/badge";
import { BookOpen, Clock, FileText, MapPin } from "lucide-react";
import Image from "next/image";
import { AssignmentMapWrapper } from "../AssignmentMapWrapper";
import { AssignmentData, SchoolData } from "@/types/models";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function TeacherNextAssignment({ nextAssignment }: { nextAssignment: AssignmentData }) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const { toast } = useToast();
  const confirm = useConfirm();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-foreground">{nextAssignment.request?.school.name}</h2>
          <p className="text-muted-foreground flex items-center gap-1 mt-1">
            <MapPin className="h-4 w-4" /> {nextAssignment.request?.school.address}
          </p>
        </div>
        <Badge className="bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-500/25 text-sm py-1">
          {new Date(nextAssignment.date).toLocaleDateString('de-DE')}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-muted p-4 rounded-xl border border-border">
          <div className="text-muted-foreground text-xs font-semibold mb-1 uppercase">Stunden</div>
          <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-orange-500"/> {nextAssignment.hours} Std.</div>
        </div>
        <div className="bg-muted p-4 rounded-xl border border-border">
          <div className="text-muted-foreground text-xs font-semibold mb-1 uppercase">Ab Stunde</div>
          <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-orange-500"/> {nextAssignment.request?.startHour}. Std</div>
        </div>
        <div className="bg-muted p-4 rounded-xl border border-border">
          <div className="text-muted-foreground text-xs font-semibold mb-1 uppercase">Klasse / Schulart</div>
          <div className="font-bold text-lg flex items-center gap-2"><BookOpen className="h-4 w-4 text-orange-500"/> {nextAssignment.request?.schoolType === 'GRUNDSCHULE' ? 'GS' : nextAssignment.request?.schoolType === 'MITTELSCHULE' ? 'MS' : 'GS/MS'}</div>
        </div>
        <div className="bg-muted dark:bg-muted/50 p-4 rounded-xl space-y-2 h-full">
          <div className="font-medium flex items-center gap-2"><FileText className="h-4 w-4" /> Bemerkungen</div>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap">
            {nextAssignment.request?.comments || 'Keine Bemerkungen hinterlegt.'}
          </div>
        </div>
      </div>

      {nextAssignment.status === 'PENDING' && (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800/30">
          <h3 className="text-amber-800 dark:text-amber-400 font-bold mb-2">Bitte bestätigen Sie diesen Einsatz</h3>
          <div className="flex flex-wrap gap-4">
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
                    toast({ variant: "error", title: "Einsatz konnte nicht akzeptiert werden.", description: err.error });
                    return;
                  }
                  window.dispatchEvent(new Event('app-refresh'));
                } catch (error) {
                  toast({ variant: "error", title: "Netzwerkfehler.", description: "Bitte versuchen Sie es erneut." });
                } finally {
                  setIsUpdatingStatus(false);
                }
              }}
              className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {isUpdatingStatus ? 'Wird verarbeitet...' : 'Einsatz akzeptieren'}
            </button>
            <button
              type="button"
              disabled={isUpdatingStatus}
              onClick={async () => {
                if (isUpdatingStatus) return;
                const confirmed = await confirm({
                  title: "Einsatz ablehnen?",
                  description: "Diesen Einsatz wirklich ablehnen?",
                  confirmLabel: "Ablehnen",
                  variant: "destructive",
                });
                if (!confirmed) return;
                setIsUpdatingStatus(true);
                try {
                  const res = await fetch(`/api/assignments/${nextAssignment.id}/status`, {
                    method: 'PATCH', body: JSON.stringify({status: 'REJECTED'}), headers: {'Content-Type': 'application/json'}
                  });
                  if (!res.ok) {
                    const err = await res.json();
                    toast({ variant: "error", title: "Einsatz konnte nicht abgelehnt werden.", description: err.error });
                    return;
                  }
                  window.dispatchEvent(new Event('app-refresh'));
                } catch (error) {
                  toast({ variant: "error", title: "Netzwerkfehler.", description: "Bitte versuchen Sie es erneut." });
                } finally {
                  setIsUpdatingStatus(false);
                }
              }}
              className="bg-secondary hover:bg-secondary/80 text-secondary-foreground px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Ablehnen
            </button>
          </div>
        </div>
      )}

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
