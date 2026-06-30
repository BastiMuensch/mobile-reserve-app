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
    <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 h-[calc(100%-12rem)] flex flex-col">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-xl">
          <Users className="h-6 w-6 text-slate-500" />
          Mobile Reserven
        </CardTitle>
      </CardHeader>
      <div className="px-6 pb-2">
        <Input 
          placeholder="Suche (Name, Schule)..." 
          value={searchTeacherQuery}
          onChange={e => setSearchTeacherQuery(e.target.value)}
          className="bg-white/50 dark:bg-slate-900/50 border-slate-200/60 dark:border-slate-800/60 rounded-xl focus-visible:ring-primary focus-visible:border-primary"
        />
      </div>
      <CardContent className="flex-1 overflow-y-auto custom-scrollbar pr-2 pt-2">
        <div className="space-y-3">
          {filteredTeachers.map(teacher => (
            <div key={teacher.id} className="group p-4 border border-slate-200/60 dark:border-slate-800/60 rounded-xl bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow relative">
              <div className="flex justify-between items-start mb-2 pr-8">
                <div className="font-bold text-slate-900 dark:text-slate-100">{teacher.name}</div>
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
                  <DropdownMenuTrigger className="h-8 w-8 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none">
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(teacher)} className="gap-2 cursor-pointer">
                      <Settings className="h-4 w-4 text-indigo-500" />
                      Bearbeiten
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFocusedLocation({ lat: teacher.homeLat, lng: teacher.homeLng })} className="gap-2 cursor-pointer">
                      <Navigation className="h-4 w-4 text-indigo-500" />
                      Auf der Karte zeigen
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openArchive(teacher)} className="gap-2 cursor-pointer">
                      <History className="h-4 w-4 text-slate-500" />
                      Archiv
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openMonthlyExport(teacher)} className="gap-2 cursor-pointer">
                      <FileDown className="h-4 w-4 text-slate-500" />
                      Monatsübersicht (PDF)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="text-sm text-slate-500 dark:text-slate-400 mb-1 line-clamp-1" title={teacher.stammschule?.name}>
                📍 {teacher.stammschule?.name}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-2">
                Auslastung: {teacher.maxWeeklyHours} Std./Woche
                {teacher.isPartTime && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Teilzeit</Badge>}
              </div>
              <div className="text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-1 rounded-md inline-block">
                {teacher.qualifications}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
