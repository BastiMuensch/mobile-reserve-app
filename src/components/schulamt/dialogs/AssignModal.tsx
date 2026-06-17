import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AssignFormData } from "@/types/models";

interface AssignModalProps {
  assignModalOpen: boolean;
  setAssignModalOpen: (val: boolean) => void;
  assignData: AssignFormData | null;
  setAssignData: (val: AssignFormData | null) => void;
  handleAssignSubmit: (e: React.FormEvent) => void;
  isAssigning: boolean;
}

export function AssignModal({
  assignModalOpen,
  setAssignModalOpen,
  assignData,
  setAssignData,
  handleAssignSubmit,
  isAssigning
}: AssignModalProps) {
  return (
    <Dialog open={assignModalOpen} onOpenChange={setAssignModalOpen}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Zuweisung anpassen</DialogTitle>
          <DialogDescription>
            Wie viele Stunden soll diese Lehrkraft übernehmen?
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleAssignSubmit} className="space-y-4 py-4">
          <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
            {assignData?.assignments.map((assignment, index) => {
               const d = new Date(assignment.date);
               const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
               return (
                <div key={index} className="flex items-center gap-3 p-3 border rounded-lg bg-slate-50 dark:bg-slate-900/50 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                    checked={assignment.selected}
                    onChange={(e) => {
                      const newAssignments = assignData.assignments.map((a, i) => 
                        i === index ? { ...a, selected: e.target.checked } : a
                      );
                      setAssignData({...assignData, assignments: newAssignments});
                    }}
                  />
                  <div className={`flex-1 font-medium ${!assignment.selected ? 'text-slate-400 line-through' : ''}`}>
                    {dayName}, {d.toLocaleDateString('de-DE')}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input 
                      type="number" 
                      min="1" 
                      max="10"
                      className="w-20"
                      value={assignment.hours}
                      disabled={!assignment.selected}
                      onChange={(e) => {
                        const newAssignments = assignData.assignments.map((a, i) => 
                        i === index ? { ...a, hours: e.target.value } : a
                      );
                        setAssignData({...assignData, assignments: newAssignments});
                      }} 
                    />
                    <span className="text-sm text-slate-500">Std.</span>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-md" disabled={isAssigning}>
              {isAssigning ? 'Wird zugewiesen...' : 'Bestätigen & Zuweisen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
