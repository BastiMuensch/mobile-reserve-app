import { Users, AlertCircle, CheckCircle2, Activity } from "lucide-react";

interface DashboardHeaderProps {
  activeTeacherCount: number;
  teacherCount: number;
  openRequestCount: number;
  filledRequestCount: number;
  sickTeacherCount: number;
  loading: boolean;
  setActiveKpiDetail: (val: 'reserven' | 'offene' | 'besetzte' | 'unavailable' | null) => void;
}

export function DashboardHeader(props: DashboardHeaderProps) {
  const metrics = [
    { id: 'offene' as const, label: 'Offene Bedarfe', value: props.openRequestCount, icon: AlertCircle, color: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40', hint: props.openRequestCount > 0 ? 'Reserve zuweisen' : 'Keine offenen Bedarfe' },
    { id: 'reserven' as const, label: 'Heute verfügbar', value: props.activeTeacherCount, icon: Users, color: 'text-primary bg-primary/10', hint: `von ${props.teacherCount} Reserven` },
    { id: 'besetzte' as const, label: 'Besetzte Bedarfe', value: props.filledRequestCount, icon: CheckCircle2, color: 'text-primary bg-primary/10', hint: 'Im ausgewählten Schuljahr' },
    { id: 'unavailable' as const, label: 'Ausfälle heute', value: props.sickTeacherCount, icon: Activity, color: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40', hint: 'Ungeplante Abwesenheiten' },
  ];
  return <section aria-label="Kennzahlen" className="grid grid-cols-2 xl:grid-cols-4 gap-4">
    {metrics.map(metric => <button key={metric.id} type="button" disabled={props.loading}
      onClick={() => props.setActiveKpiDetail(metric.id)}
      className="flex items-center gap-5 rounded-xl border border-border/70 bg-card p-5 sm:px-6 text-left hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait">
      <span className={`hidden sm:grid size-14 shrink-0 place-items-center rounded-full ${metric.color}`}><metric.icon className="size-6" aria-hidden="true" /></span>
      <span className="min-w-0"><span className="block text-4xl font-medium tabular-nums">{props.loading ? '—' : metric.value}</span>
        <span className="block text-sm sm:text-base mt-1">{metric.label}</span>
        <span className="block text-xs text-muted-foreground mt-2">{props.loading ? 'Wird geladen …' : metric.hint}</span>
      </span>
    </button>)}
  </section>;
}
