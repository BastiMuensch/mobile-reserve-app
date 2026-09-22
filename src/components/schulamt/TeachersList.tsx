import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, MoreVertical, Pencil, Navigation, History, FileDown, CalendarOff, Phone, Mail, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TeacherData } from "@/types/models";
import { formatLeaveBadge, formatLeaveRange } from "@/lib/leave";
import { getWeekBounds, toLocalDayStart } from "@/lib/matching";

interface TeachersListProps {
  filteredTeachers: TeacherData[];
  searchTeacherQuery: string;
  setSearchTeacherQuery: (val: string) => void;
  toggleAbsence: (teacher: TeacherData) => void;
  openEdit: (teacher: TeacherData) => void;
  setFocusedLocation: (loc: { lat: number, lng: number } | null) => void;
  openArchive: (teacher: TeacherData) => void;
  openMonthlyExport: (teacher: TeacherData) => void;
  openLeavePeriods: (teacher: TeacherData) => void;
  openDelete: (teacher: TeacherData) => void;
}

type StatusFilterId = 'ALLE' | 'AKTIV' | 'AUSFALL_HEUTE' | 'LAENGERE_ABWESENHEIT';

// Rein von den bereits geladenen Feldern abgeleitet - keine eigene Statusmaschine.
// Die Kategorien schließen sich gegenseitig nicht aus (z.B. "Aktiv" und "Ausfall heute"
// können beide zutreffen), das ist bewusst so wie bei den übrigen Feldern der Lehrkraft.
const STATUS_FILTERS: { id: StatusFilterId; label: string; activeClass: string; predicate: (t: TeacherData) => boolean }[] = [
  { id: 'ALLE', label: 'Alle', activeClass: 'bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-500/20 dark:text-slate-200 dark:border-slate-500/40', predicate: () => true },
  { id: 'AKTIV', label: 'Aktiv', activeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40', predicate: t => t.status === 'ACTIVE' },
  { id: 'AUSFALL_HEUTE', label: 'Ausfall heute', activeClass: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40', predicate: t => !!t.isAbsentToday },
  { id: 'LAENGERE_ABWESENHEIT', label: 'Längere Abwesenheit', activeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40', predicate: t => !!t.currentLeave },
];

const PREFERRED_TYPE_LABELS: Record<string, string> = {
  GRUNDSCHULE: 'Grundschule',
  MITTELSCHULE: 'Mittelschule',
  BOTH: 'Beide Schularten',
};

/** Summe der nicht-abgelehnten Einsatzstunden dieser Woche (Mo-So, lokale Tagesgrenzen). */
function weeklyLoadFor(teacher: TeacherData, weekStart: Date, weekEnd: Date): number {
  return (teacher.assignments ?? [])
    .filter(a => a.status !== 'REJECTED')
    .filter(a => {
      const day = toLocalDayStart(a.date);
      return day >= weekStart && day <= weekEnd;
    })
    .reduce((sum, a) => sum + a.hours, 0);
}

export function TeachersList({
  filteredTeachers,
  searchTeacherQuery,
  setSearchTeacherQuery,
  toggleAbsence,
  openEdit,
  setFocusedLocation,
  openArchive,
  openMonthlyExport,
  openLeavePeriods,
  openDelete
}: TeachersListProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilterId>('ALLE');

  // Aktuelle Kalenderwoche einmal pro Aufruf bestimmen, nicht pro Lehrkraft.
  const { weekStart, weekEnd } = getWeekBounds(new Date());

  const activeFilter = STATUS_FILTERS.find(f => f.id === statusFilter) ?? STATUS_FILTERS[0];
  const visibleTeachers = useMemo(
    () => filteredTeachers.filter(activeFilter.predicate),
    [filteredTeachers, activeFilter]
  );

  return (
    <Card className="shadow-none bg-card ring-border/70 py-6 gap-6">
      <CardHeader className="px-5 sm:px-6 gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Users className="h-6 w-6 text-muted-foreground" />
            Mobile Reserven ({filteredTeachers.length})
          </CardTitle>
          <Input
            placeholder="Suche (Name, Schule)..."
            aria-label="Mobile Reserven nach Name oder Schule durchsuchen"
            value={searchTeacherQuery}
            onChange={e => setSearchTeacherQuery(e.target.value)}
            className="h-10 bg-card border-border/70 rounded-lg focus-visible:ring-primary focus-visible:border-primary sm:w-72"
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Nach Status filtern">
          {STATUS_FILTERS.map(f => {
            const isActive = f.id === statusFilter;
            const count = filteredTeachers.filter(f.predicate).length;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setStatusFilter(f.id)}
                className={`text-sm font-medium min-h-10 px-3 py-2 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive ? f.activeClass : 'bg-card text-muted-foreground border-border hover:border-primary/40'
                }`}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="px-5 sm:px-6">
        <div className="grid grid-cols-1 min-[1200px]:grid-cols-2 min-[1800px]:grid-cols-3 gap-5">
          {visibleTeachers.length === 0 && (
            <p className="col-span-full text-muted-foreground italic py-4">
              Keine Lehrkraft entspricht der Auswahl.
            </p>
          )}
          {visibleTeachers.map(teacher => {
            // Künftige Zeiträume: alles, was noch nicht läuft - für die Vorausplanung.
            const upcomingLeaves = (teacher.leavePeriods ?? []).filter(l => l.id !== teacher.currentLeave?.id);
            const qualificationChips = teacher.qualifications.split(',').map(q => q.trim()).filter(Boolean);
            const preferredTypeLabel = PREFERRED_TYPE_LABELS[teacher.preferredType];
            const weeklyLoad = weeklyLoadFor(teacher, weekStart, weekEnd);
            const loadPct = teacher.maxWeeklyHours > 0 ? Math.min(100, (weeklyLoad / teacher.maxWeeklyHours) * 100) : 0;
            const isAtOrOverMax = weeklyLoad >= teacher.maxWeeklyHours;
            return (
            <div key={teacher.id} className="group p-5 sm:p-6 border border-border/70 rounded-xl bg-card relative">
              <div className="flex flex-wrap justify-between items-start gap-3 mb-4 pr-8">
                <div className="font-medium text-lg text-foreground flex items-center gap-2 flex-wrap break-words min-w-0">
                  {teacher.name}
                  {teacher.isAbsentToday && (
                    <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400">
                      Heute abwesend
                    </Badge>
                  )}
                </div>
                {teacher.currentLeave ? (
                  // Läuft eine Langzeitabwesenheit, ist der Aktiv/Ausfall-Schalter irreführend:
                  // die Lehrkraft ist unabhängig davon nicht einsetzbar.
                  <Badge
                    variant="outline"
                    className="shadow-sm bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20"
                    title={`Längere Abwesenheit: ${formatLeaveRange(teacher.currentLeave.startDate, teacher.currentLeave.endDate)}`}
                  >
                    {formatLeaveBadge(teacher.currentLeave.endDate)}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className={`cursor-pointer transition-colors shadow-sm ${teacher.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${teacher.name}: ${teacher.status === 'ACTIVE' ? 'Als ausgefallen markieren' : 'Wieder aktiv setzen'}`}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleAbsence(teacher); }
                    }}
                    onClick={() => toggleAbsence(teacher)}
                    title="Status ändern (Ausfall / Aktiv)"
                  >
                    {teacher.status === 'ACTIVE' ? 'Aktiv' : 'Ausfall'}
                  </Badge>
                )}
              </div>

              {/* DROPDOWN MENU */}
              <div className="absolute top-3 right-2">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Aktionen für ${teacher.name}`}
                    className="h-11 w-11 text-muted-foreground hover:text-foreground flex items-center justify-center rounded-lg hover:bg-muted data-popup-open:bg-muted data-popup-open:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={8} className="w-72 min-w-0 max-w-[calc(100vw-2rem)] rounded-xl p-1.5 shadow-lg ring-border [&_[data-slot=dropdown-menu-item]]:min-h-11 [&_[data-slot=dropdown-menu-item]]:gap-3 [&_[data-slot=dropdown-menu-item]]:px-3 [&_[data-slot=dropdown-menu-item]]:py-2.5 [&_[data-slot=dropdown-menu-item]]:cursor-pointer [&_[data-slot=dropdown-menu-item]]:break-words">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-3 pt-2 pb-1.5">Verwalten</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => openEdit(teacher)}>
                        <Pencil className="size-4 text-muted-foreground" />
                        Bearbeiten
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setFocusedLocation({ lat: teacher.homeLat, lng: teacher.homeLng })}>
                        <Navigation className="size-4 text-muted-foreground" />
                        Auf der Karte zeigen
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openLeavePeriods(teacher)}>
                        <CalendarOff className="size-4 text-muted-foreground" />
                        Längere Abwesenheit
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator className="mx-1 my-1.5" />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-3 py-1.5">Nachweise</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => openArchive(teacher)}>
                        <History className="size-4 text-muted-foreground" />
                        Archiv
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openMonthlyExport(teacher)}>
                        <FileDown className="size-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1">Monatsübersicht</span>
                        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">PDF</span>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator className="mx-1 my-1.5" />
                    <DropdownMenuItem variant="destructive" onClick={() => openDelete(teacher)}>
                      <Trash2 className="size-4" />
                      Mobile Reserve löschen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="text-sm text-muted-foreground mb-1 line-clamp-1" title={teacher.stammschule?.name}>
                📍 {teacher.stammschule?.name}
              </div>
              {(teacher.phone || teacher.email) && (
                <div className="text-sm text-muted-foreground mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 [overflow-wrap:anywhere]">
                  {teacher.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {teacher.phone}
                    </span>
                  )}
                  {teacher.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {teacher.email}
                    </span>
                  )}
                </div>
              )}
              {/* Die Wochenstunden stehen im Balken darunter - eine eigene Zeile
                  "Auslastung: 28 Std./Woche" wiederholte nur den Nenner. */}
              <div className="mb-3">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-2">
                  {weeklyLoad} / {teacher.maxWeeklyHours} Std. diese Woche
                  {teacher.isPartTime && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Teilzeit</Badge>}
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isAtOrOverMax ? 'bg-amber-500' : 'bg-primary'}`}
                    style={{ width: `${loadPct}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mb-1">
                {qualificationChips.map(q => (
                  <span key={q} className="text-xs font-medium bg-muted text-muted-foreground px-2.5 py-1 rounded-md inline-block">
                    {q}
                  </span>
                ))}
              </div>
              {preferredTypeLabel && (
                <div className="text-[11px] text-muted-foreground">
                  Bevorzugt: {preferredTypeLabel}
                </div>
              )}

              {upcomingLeaves.length > 0 && (
                <div className="mt-3 text-xs text-amber-700 dark:text-amber-400 flex flex-col gap-0.5">
                  {upcomingLeaves.map(leave => (
                    <span key={leave.id}>
                      Abwesend geplant: {formatLeaveRange(leave.startDate, leave.endDate)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
