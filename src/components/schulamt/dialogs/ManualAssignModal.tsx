import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TeacherData, RequestData } from "@/types/models";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ManualAssignModalProps {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
  allTeachers: TeacherData[];
  activeRequest: RequestData | null;
  onSelectCandidate: (candidate: TeacherData) => void;
}

export function ManualAssignModal({
  isOpen,
  setIsOpen,
  allTeachers,
  activeRequest,
  onSelectCandidate
}: ManualAssignModalProps) {
  const [search, setSearch] = useState("");

  const filteredTeachers = allTeachers.filter(t => 
    t.status === 'ACTIVE' && 
    (t.name.toLowerCase().includes(search.toLowerCase()) || 
     (t.stammschule?.name && t.stammschule.name.toLowerCase().includes(search.toLowerCase())))
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manuelle Zuweisung</DialogTitle>
          <DialogDescription>
            Wählen Sie eine beliebige Lehrkraft aus dem gesamten Pool aus, um die Matching-Engine für die Anfrage von <strong>{activeRequest?.school?.name}</strong> zu überschreiben.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-2">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Lehrkraft oder Schule suchen..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto mt-4 space-y-3 custom-scrollbar pr-2 min-h-[300px]">
          {filteredTeachers.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Keine Lehrkräfte gefunden.</p>
          ) : (
            filteredTeachers.map(teacher => (
              <div 
                key={teacher.id} 
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-900 dark:text-slate-100">{teacher.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                    {teacher.stammschule?.name}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="outline" className="text-[10px] bg-white dark:bg-slate-950">
                      {teacher.assignedHours || 0}/{teacher.maxWeeklyHours}h
                    </Badge>
                    <Badge variant="outline" className="text-[10px] bg-white dark:bg-slate-950">
                      {teacher.qualifications}
                    </Badge>
                  </div>
                </div>
                <Button 
                  onClick={() => {
                    setIsOpen(false);
                    onSelectCandidate(teacher);
                  }}
                  variant="default"
                  size="sm"
                  className="shrink-0"
                >
                  Auswählen
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
