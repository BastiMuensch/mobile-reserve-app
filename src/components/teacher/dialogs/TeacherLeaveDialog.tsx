import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeavePeriodManager } from "@/components/leave/LeavePeriodManager";
import { CalendarOff } from "lucide-react";

/** Sicht der Lehrkraft: eine längere Abwesenheit für sich selbst melden. */
export function TeacherLeaveDialog({
  isOpen,
  setIsOpen,
  onChanged,
}: {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  onChanged?: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarOff className="h-5 w-5 text-primary" /> Längere Abwesenheit melden
          </DialogTitle>
          <DialogDescription>
            Melden Sie hier den Zeitraum, in dem Sie nicht für Einsätze zur Verfügung stehen.
            Ihr Schulamt wird benachrichtigt und plant Sie in dieser Zeit nicht ein.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 p-4 rounded-xl text-sm border border-amber-200 dark:border-amber-900/50 font-medium">
          Diese Meldung ersetzt nicht die offizielle Mitteilung an Ihre Stammschule und Ihr
          Schulamt – bitte melden Sie den Grund und reichen Sie die erforderlichen Nachweise
          wie gewohnt auf dem Dienstweg ein.
        </div>

        <LeavePeriodManager onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}
