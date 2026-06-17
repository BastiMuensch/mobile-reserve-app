import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { UserPlus, Copy, Users, AlertCircle, CheckCircle2, Activity } from "lucide-react";
import { getCurrentSchoolYear, getNextSchoolYear } from "@/lib/schoolYear";
import { TeacherData, RequestData } from "@/types/models";

interface DashboardHeaderProps {
  selectedYear: string;
  setSelectedYear: (val: string) => void;
  availableYears: string[];
  teachers: TeacherData[];
  requests: RequestData[];
  setIsAddTeacherOpen: (val: boolean) => void;
  handleCopyTeachers: () => void;
  isCopying: boolean;
  setActiveKpiDetail: (val: 'reserven' | 'offene' | 'besetzte' | 'krank' | null) => void;
  activeTeacherCount: number;
  openRequestCount: number;
  filledRequestCount: number;
  sickTeacherCount: number;
}

export function DashboardHeader({
  selectedYear, setSelectedYear, availableYears, teachers,
  setIsAddTeacherOpen, handleCopyTeachers, isCopying, setActiveKpiDetail,
  activeTeacherCount, openRequestCount, filledRequestCount, sickTeacherCount
}: DashboardHeaderProps) {
  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/60 dark:bg-slate-900/65 p-6 rounded-2xl border border-white/20 dark:border-slate-800/40 backdrop-blur-xl shadow-lg relative overflow-hidden transform-gpu" style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)' }}>
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-primary">Schulamt-Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Bedarfsplanung, Einsatzsteuerung und Mobile Reserven verwalten.</p>
        </div>
        
        <div className="flex items-center gap-4 relative z-10">
          <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-1 shadow-sm">
            <span className="text-sm font-medium text-slate-500 pl-3">Schuljahr:</span>
            <Select value={selectedYear} onValueChange={(val) => val && setSelectedYear(val)}>
              <SelectTrigger className="w-[140px] border-0 shadow-none bg-transparent font-bold text-primary focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map(y => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={() => setIsAddTeacherOpen(true)} className="gap-2 bg-primary hover:bg-primary/95 text-primary-foreground shadow-md hover:shadow-primary/20 hover:scale-[1.01] transition-all duration-300 rounded-xl">
            <UserPlus className="h-4 w-4" /> Lehrkraft hinzufügen
          </Button>
          
          {selectedYear === getNextSchoolYear() && teachers.length === 0 && (
            <Button onClick={handleCopyTeachers} disabled={isCopying} variant="outline" className="gap-2 border-primary/20 text-primary hover:bg-primary/10 dark:border-primary/40 dark:text-primary dark:hover:bg-primary/20 rounded-xl hover:scale-[1.01] transition-all duration-300">
              <Copy className="h-4 w-4" /> {isCopying ? "Kopiere..." : "Lehrkräfte aus Vorjahr übernehmen"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div onClick={() => setActiveKpiDetail('reserven')} className="glass-card p-6 rounded-2xl relative overflow-hidden group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-colors pointer-events-none" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/10 text-primary rounded-xl"><Users className="h-6 w-6" /></div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mobile Reserven</p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{activeTeacherCount} <span className="text-sm font-normal text-slate-400">/ {teachers.length} aktiv</span></h3>
            </div>
          </div>
        </div>

        <div onClick={() => setActiveKpiDetail('offene')} className="glass-card p-6 rounded-2xl relative overflow-hidden group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95">
          <div className={`absolute top-0 right-0 w-24 h-24 ${openRequestCount > 0 ? 'bg-amber-500/10 group-hover:bg-amber-500/20' : 'bg-slate-500/10 group-hover:bg-slate-500/20'} rounded-full blur-2xl transition-colors pointer-events-none`} />
          <div className="flex items-center gap-4">
            <div className={`p-3 ${openRequestCount > 0 ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-500'} rounded-xl`}>
              <AlertCircle className={`h-6 w-6 ${openRequestCount > 0 ? 'animate-pulse' : ''}`} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Offene Bedarfe</p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">
                {openRequestCount} 
                {openRequestCount > 0 ? (
                  <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/15 border border-amber-500/20 px-2 py-0.5 rounded-full ml-2">Aktion nötig</span>
                ) : (
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 rounded-full ml-2">Alles erledigt</span>
                )}
              </h3>
            </div>
          </div>
        </div>

        <div onClick={() => setActiveKpiDetail('besetzte')} className="glass-card p-6 rounded-2xl relative overflow-hidden group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-colors pointer-events-none" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-xl"><CheckCircle2 className="h-6 w-6" /></div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Besetzte Bedarfe</p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{filledRequestCount} <span className="text-sm font-normal text-slate-400">erfolgreich</span></h3>
            </div>
          </div>
        </div>

        <div onClick={() => setActiveKpiDetail('krank')} className="glass-card p-6 rounded-2xl relative overflow-hidden group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl group-hover:bg-rose-500/20 transition-colors pointer-events-none" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-rose-500/10 text-rose-500 rounded-xl"><Activity className="h-6 w-6" /></div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Krankenstand</p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{sickTeacherCount} <span className="text-sm font-normal text-rose-500">Lehrkräfte</span></h3>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
