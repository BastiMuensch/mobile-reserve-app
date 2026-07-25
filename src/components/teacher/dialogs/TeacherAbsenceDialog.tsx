import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export function TeacherAbsenceDialog({
  isOpen,
  setIsOpen,
  absenceDate,
  setAbsenceDate,
  absenceReason,
  setAbsenceReason,
  handleReportAbsence,
  isSubmittingAbsence
}: {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  absenceDate: string;
  setAbsenceDate: (v: string) => void;
  absenceReason: string;
  setAbsenceReason: (v: string) => void;
  handleReportAbsence: (e: React.FormEvent) => void;
  isSubmittingAbsence: boolean;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-rose-600 dark:text-rose-400 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> Ungeplanten Ausfall melden
          </DialogTitle>
          <DialogDescription>
            Melden Sie hier einen ungeplanten Ausfall. Eventuelle Einsätze an diesem Tag werden automatisch an das Schulamt zurückgegeben.
          </DialogDescription>
        </DialogHeader>
        
        <div className="bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 p-4 rounded-xl text-sm border border-rose-200 dark:border-rose-900/50 mb-4 font-medium">
          <strong>ACHTUNG:</strong> Bitte melden Sie sich trotz dieser System-Meldung weiterhin offiziell telefonisch bei Ihrer Stammschule ab!
        </div>

        <form onSubmit={handleReportAbsence} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="absence-date">Datum des Ausfalls</Label>
            <Input
              id="absence-date"
              type="date"
              value={absenceDate}
              onChange={e => setAbsenceDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="absence-reason">Begründung</Label>
            <Textarea
              id="absence-reason"
              placeholder="Bitte geben Sie den Grund für Ihren Ausfall an."
              value={absenceReason}
              onChange={e => setAbsenceReason(e.target.value)}
              required
              minLength={5}
              className="h-24"
            />
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Abbrechen</Button>
            <Button type="submit" disabled={isSubmittingAbsence} className="bg-rose-600 hover:bg-rose-700 text-white">
              {isSubmittingAbsence ? "Wird gemeldet..." : "Ausfall melden"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
