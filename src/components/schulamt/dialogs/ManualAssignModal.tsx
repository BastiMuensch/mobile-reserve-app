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
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Lehrkraft oder Schule suchen..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto mt-4 space-y-3 custom-scrollbar pr-2 min-h-[300px]">
          {filteredTeachers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Keine Lehrkräfte gefunden.</p>
          ) : (
            filteredTeachers.map(teacher => (
              <div
                key={teacher.id}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border border-border rounded-xl bg-muted/50 hover:bg-muted transition-colors gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-foreground">{teacher.name}</div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    {teacher.stammschule?.name}
                  </div>
                  {teacher.hasConflict && (
                    <div className="text-[10px] font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/15 px-1.5 py-0.5 rounded mt-1.5 inline-block">
                      ⚠️ Terminkonflikt
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="outline" className="text-[10px] bg-card">
                      {teacher.assignedHours || 0}/{teacher.maxWeeklyHours}h
                    </Badge>
                    <Badge variant="outline" className="text-[10px] bg-card">
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
