import { useMemo } from 'react';
import { FileDown } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { groupAssignmentProofs } from '@/lib/assignmentProofGroups';
import { assignmentDay, formatProofDate } from '@/lib/assignmentSeries';
import type { AssignmentData } from '@/types/models';

export function AssignmentProofList({ assignments }: { assignments: AssignmentData[] }) {
  const groups = useMemo(() => groupAssignmentProofs(assignments), [assignments]);
  if (!groups.length) return <p className="py-6 text-center text-sm text-muted-foreground">Noch keine Einsatznachweise vorhanden.</p>;

  return <ul className="space-y-3" aria-label="Einsatznachweise">
    {groups.map(series => {
      const first = series[0];
      const last = series[series.length - 1];
      const cancelled = first.status === 'REJECTED';
      const school = first.request?.school.name || 'Schule';
      const period = assignmentDay(first.date) === assignmentDay(last.date)
        ? formatProofDate(first.date) : `${formatProofDate(first.date)} – ${formatProofDate(last.date)}`;
      const hours = series.reduce((sum, row) => sum + row.hours, 0);
      return <li key={first.id} className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
        <div className="min-w-0 space-y-1">
          <p className="break-words font-medium">{school}</p>
          <p className="text-sm text-muted-foreground">{period}</p>
          {cancelled ? <p className="text-sm font-medium text-destructive"><span>Storniert</span> · keine aktiven Stunden</p>
            : <p className="text-sm text-muted-foreground">{series.length} {series.length === 1 ? 'Einsatztag' : 'Einsatztage'} · {hours} {hours === 1 ? 'Unterrichtsstunde' : 'Unterrichtsstunden'}</p>}
        </div>
        <a href={`/api/assignments/${encodeURIComponent(first.id)}/pdf`} target="_blank" rel="noopener noreferrer"
          aria-label={`${cancelled ? 'Stornierten Nachweis' : 'Einsatznachweis'} für ${school}, ${period}, als PDF herunterladen`}
          className={buttonVariants({ variant: 'outline', className: 'w-full sm:w-auto' })}>
          <FileDown className="size-4" />{cancelled ? 'Stornierten Nachweis herunterladen' : 'PDF herunterladen'}
        </a>
      </li>;
    })}
  </ul>;
}
