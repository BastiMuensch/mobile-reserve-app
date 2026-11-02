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
    { id: 'offene' as const, label: 'Offene Bedarfe', short: 'Offen', value: props.openRequestCount, icon: AlertCircle, color: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40', hint: props.openRequestCount > 0 ? 'Reserve zuweisen' : 'Keine offenen Bedarfe' },
    { id: 'reserven' as const, label: 'Heute verfügbar', short: 'Verfügbar', value: props.activeTeacherCount, icon: Users, color: 'text-primary bg-primary/10', hint: `von ${props.teacherCount} Reserven` },
    { id: 'besetzte' as const, label: 'Besetzte Bedarfe', short: 'Besetzt', value: props.filledRequestCount, icon: CheckCircle2, color: 'text-primary bg-primary/10', hint: 'Im ausgewählten Schuljahr' },
    { id: 'unavailable' as const, label: 'Ausfälle heute', short: 'Ausfälle', value: props.sickTeacherCount, icon: Activity, color: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40', hint: 'Ungeplante Abwesenheiten' },
  ];
  // Phones get one compact row so the first open demand is visible without scrolling.
  return <section aria-label="Kennzahlen" className="grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
    {metrics.map(metric => <button key={metric.id} type="button" disabled={props.loading}
      onClick={() => props.setActiveKpiDetail(metric.id)}
      aria-label={`${metric.label}: ${props.loading ? 'wird geladen' : metric.value}`}
      className="flex min-w-0 flex-col items-center gap-0.5 rounded-xl border border-border/70 bg-card px-1 py-2.5 text-center hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait sm:flex-row sm:items-center sm:gap-5 sm:px-6 sm:py-5 sm:text-left">
      <span className={`hidden size-10 shrink-0 place-items-center rounded-full sm:grid sm:size-14 ${metric.color}`}><metric.icon className="size-5 sm:size-6" aria-hidden="true" /></span>
      <span className="min-w-0">
        <span className={`block text-2xl font-medium tabular-nums sm:text-4xl ${metric.id === 'offene' && metric.value > 0 ? 'text-amber-700 dark:text-amber-300 sm:text-foreground' : ''}`}>{props.loading ? '—' : metric.value}</span>
        <span className="block text-[11px] leading-tight text-muted-foreground sm:hidden">{metric.short}</span>
        <span className="mt-1 hidden text-sm sm:block sm:text-base">{metric.label}</span>
        <span className="mt-2 hidden text-xs text-muted-foreground sm:block">{props.loading ? 'Wird geladen …' : metric.hint}</span>
      </span>
    </button>)}
  </section>;
}
