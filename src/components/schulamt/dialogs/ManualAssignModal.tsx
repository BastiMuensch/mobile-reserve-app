import { canTeacherWorkAtSchool } from '@/lib/teacherSchoolEligibility';
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TeacherData, RequestData } from "@/types/models";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getOpenRequestDays } from "@/lib/requestDays";
import { getSchoolYearForDate } from "@/lib/schoolYear";
import { deploymentSchoolName } from "@/lib/schoolLocations";

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

  const eligibleSchoolYears = new Set((activeRequest ? getOpenRequestDays(activeRequest, activeRequest.assignments || []) : []).map(day =>
    getSchoolYearForDate(new Date(`${day.date}T12:00:00.000Z`))
  ));
  const filteredTeachers = allTeachers.filter(t => 
    t.status === 'ACTIVE' &&
    activeRequest !== null && canTeacherWorkAtSchool(t, activeRequest.schoolId) &&
    eligibleSchoolYears.has(t.schoolYear) &&
    (t.name.toLowerCase().includes(search.toLowerCase()) || 
     (t.stammschule?.name && t.stammschule.name.toLowerCase().includes(search.toLowerCase())))
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[500px] max-h-[90dvh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Manuelle Zuweisung</DialogTitle>
          <DialogDescription>
            Wählen Sie eine Lehrkraft. Verfügbare Tage, Stunden und mögliche Ausnahmen prüfen Sie im nächsten Schritt.
          </DialogDescription>
        </DialogHeader>
        {activeRequest && <div className="shrink-0 rounded-lg bg-muted p-3">
          <p className="text-xs font-medium text-primary">Ausgewählter Bedarf</p>
          <p className="mt-1 break-words font-semibold">{deploymentSchoolName(activeRequest)}{activeRequest.className ? ` · Klasse ${activeRequest.className}` : ''}</p>
          <p className="mt-1 text-sm text-muted-foreground">Ab {new Date(activeRequest.date).toLocaleDateString('de-DE')} · {activeRequest.substitutedTeacher || 'Vertretene Lehrkraft nicht angegeben'}</p>
        </div>}

        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Lehrkraft oder Schule suchen"
            placeholder="Lehrkraft oder Schule suchen..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2 min-h-0">
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
                    <div className="text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/15 px-1.5 py-0.5 rounded mt-1.5 inline-block">
                      ⚠️ Terminkonflikt
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="outline" className="text-xs bg-card">
                      {teacher.assignedHours || 0}/{teacher.maxWeeklyHours}h
                    </Badge>
                    <Badge variant="outline" className="text-xs bg-card">
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
                  aria-label={`${teacher.name} auswählen`}
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
