import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, MoreVertical, Settings, Navigation, History, FileDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TeacherData } from "@/types/models";

interface TeachersListProps {
  filteredTeachers: TeacherData[];
  searchTeacherQuery: string;
  setSearchTeacherQuery: (val: string) => void;
  toggleAbsence: (teacher: TeacherData) => void;
  openEdit: (teacher: TeacherData) => void;
  setFocusedLocation: (loc: { lat: number, lng: number } | null) => void;
  openArchive: (teacher: TeacherData) => void;
  openMonthlyExport: (teacher: TeacherData) => void;
}

export function TeachersList({
  filteredTeachers,
  searchTeacherQuery,
  setSearchTeacherQuery,
  toggleAbsence,
  openEdit,
  setFocusedLocation,
  openArchive,
  openMonthlyExport
}: TeachersListProps) {
  return (
    <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60 h-[calc(100%-12rem)] flex flex-col">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-xl">
          <Users className="h-6 w-6 text-muted-foreground" />
          Mobile Reserven
        </CardTitle>
      </CardHeader>
      <div className="px-6 pb-2">
        <Input
          placeholder="Suche (Name, Schule)..."
          value={searchTeacherQuery}
          onChange={e => setSearchTeacherQuery(e.target.value)}
          className="bg-card/50 border-border/60 rounded-xl focus-visible:ring-primary focus-visible:border-primary"
        />
      </div>
      <CardContent className="flex-1 overflow-y-auto custom-scrollbar pr-2 pt-2">
        <div className="space-y-3">
          {filteredTeachers.map(teacher => (
            <div key={teacher.id} className="group p-4 border border-border/60 rounded-xl bg-card shadow-sm hover:shadow-md transition-shadow relative">
              <div className="flex justify-between items-start mb-2 pr-8">
                <div className="font-bold text-foreground flex items-center gap-2 flex-wrap">
                  {teacher.name}
                  {teacher.isAbsentToday && (
                    <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400">
                      Heute abwesend
                    </Badge>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={`cursor-pointer transition-colors shadow-sm ${teacher.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'}`}
                  onClick={() => toggleAbsence(teacher)}
                  title="Status ändern (Ausfall / Aktiv)"
                >
                  {teacher.status === 'ACTIVE' ? 'AKTIV' : 'AUSFALL'}
                </Badge>
              </div>

              {/* DROPDOWN MENU */}
              <div className="absolute top-3 right-2">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Aktionen für ${teacher.name}`}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground flex items-center justify-center rounded-md hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(teacher)} className="gap-2 cursor-pointer">
                      <Settings className="h-4 w-4 text-primary" />
                      Bearbeiten
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFocusedLocation({ lat: teacher.homeLat, lng: teacher.homeLng })} className="gap-2 cursor-pointer">
                      <Navigation className="h-4 w-4 text-primary" />
                      Auf der Karte zeigen
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openArchive(teacher)} className="gap-2 cursor-pointer">
                      <History className="h-4 w-4 text-muted-foreground" />
                      Archiv
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openMonthlyExport(teacher)} className="gap-2 cursor-pointer">
                      <FileDown className="h-4 w-4 text-muted-foreground" />
                      Monatsübersicht (PDF)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="text-sm text-muted-foreground mb-1 line-clamp-1" title={teacher.stammschule?.name}>
                📍 {teacher.stammschule?.name}
              </div>
              <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
                Auslastung: {teacher.maxWeeklyHours} Std./Woche
                {teacher.isPartTime && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Teilzeit</Badge>}
              </div>
              <div className="text-xs font-medium bg-muted text-muted-foreground px-2.5 py-1 rounded-md inline-block">
                {teacher.qualifications}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
