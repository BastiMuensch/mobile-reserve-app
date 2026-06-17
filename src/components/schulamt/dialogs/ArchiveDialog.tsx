import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDown } from "lucide-react";
import { TeacherData, AssignmentData } from "@/types/models";

interface ArchiveDialogProps {
  archiveTeacher: TeacherData | null;
  setArchiveTeacher: (val: TeacherData | null) => void;
  archiveData: AssignmentData[];
}

export function ArchiveDialog({
  archiveTeacher,
  setArchiveTeacher,
  archiveData
}: ArchiveDialogProps) {
  return (
    <Dialog open={!!archiveTeacher} onOpenChange={(open) => !open && setArchiveTeacher(null)}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between mr-8">
          <DialogTitle>Archiv: {archiveTeacher?.name}</DialogTitle>
          {archiveData.length > 0 && (
            <button className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-300" onClick={() => window.location.href = `/api/teachers/${archiveTeacher?.id}/export`}>
              <FileDown className="h-4 w-4" /> Excel Export
            </button>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 py-4">
          {archiveData.length === 0 ? (
            <div className="text-center py-8 text-slate-500">Keine bisherigen Einsätze gefunden.</div>
          ) : (
            <div className="space-y-3">
              {archiveData.map((assignment: AssignmentData) => (
                <div key={assignment.id} className="p-4 border rounded-xl bg-slate-50 dark:bg-slate-900/50">
                    <div className="font-bold mb-1">{assignment.request?.school.name}</div>
                    <div className="text-xs text-slate-500 mb-2">{assignment.request?.schedule ? 'Individueller Plan' : `ab ${assignment.request?.startHour}. Stunde (${assignment.request?.hours}h)`}</div>
                    <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                      <span>📅 {new Date(assignment.date).toLocaleDateString('de-DE')}</span>
                      <span>⏱️ {assignment.hours} Std.</span>
                    </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
