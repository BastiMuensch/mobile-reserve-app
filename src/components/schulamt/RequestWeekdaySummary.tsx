import { getRequestWeekdaySummary } from '@/lib/requestWeekdaySummary';
import type { RequestData } from '@/types/models';

export function RequestWeekdaySummary({ request }: { request: RequestData }) {
  const summary = getRequestWeekdaySummary(request);
  if (!summary) {
    return <span className="block text-xs text-muted-foreground">Tagesverteilung nicht verfügbar</span>;
  }
  const formatDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const weekLabel = `${formatDate(summary.weekStart)}–${formatDate(summary.weekEnd)}`;

  return (
    <span className="block w-full max-w-sm space-y-1.5">
      <span className="block text-[11px] leading-relaxed text-muted-foreground">Woche {weekLabel} · offen / angefragt (Std.)</span>
      <span className="grid grid-cols-5 gap-1.5" aria-label={`Offene und angefragte Vertretungsstunden in der Woche ${weekLabel}`}>
        {summary.days.map(({ day, date, label, name, requiredHours, openHours, declinedHours }) => (
          <span
            key={day}
            title={`${name}, ${formatDate(date)}: ${requiredHours > 0 ? `${openHours} von ${requiredHours} Stunden offen${declinedHours > 0 ? `, ${declinedHours} abgesagt` : ''}` : 'kein Bedarf im Planungszeitraum'}`}
            aria-label={`${name}, ${formatDate(date)}: ${openHours} von ${requiredHours} Stunden offen${declinedHours > 0 ? `, ${declinedHours} abgesagt` : ''}`}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 ${
              declinedHours > 0
                ? 'border-rose-200 bg-rose-50/60 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300'
                : openHours > 0
                  ? 'border-primary/15 bg-primary/[0.06] text-primary'
                  : 'border-border/50 bg-muted/30 text-muted-foreground'
            }`}
          >
            <span className="text-[11px] font-medium">{label}</span>
            <span className="text-sm font-semibold tabular-nums">{requiredHours > 0 ? <>{openHours}<span className="font-normal opacity-65">/{requiredHours}</span></> : '–'}</span>
          </span>
        ))}
      </span>
      {summary.days.some(day => day.declinedHours > 0) && <span className="block text-[11px] text-rose-700 dark:text-rose-300">Rosa markiert: Stunden abgesagt</span>}
    </span>
  );
}
