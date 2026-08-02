import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeavePeriodManager } from "@/components/leave/LeavePeriodManager";
import { TeacherData } from "@/types/models";

interface LeavePeriodDialogProps {
  teacher: TeacherData | null;
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
  onChanged: () => void;
}

/** Schulamts-Sicht: längere Abwesenheiten einer Lehrkraft eintragen und einsehen. */
export function LeavePeriodDialog({ teacher, isOpen, setIsOpen, onChanged }: LeavePeriodDialogProps) {
  if (!teacher) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Längere Abwesenheit</DialogTitle>
          <DialogDescription>
            Zeiträume für <strong>{teacher.name}</strong>, in denen keine Einsätze möglich sind.
            Die Lehrkraft wird dann nicht als Kandidatin oder Kandidat vorgeschlagen und kann
            auch nicht manuell zugewiesen werden.
          </DialogDescription>
        </DialogHeader>
        <LeavePeriodManager teacherId={teacher.id} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}
