import { Clock, Navigation, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getOpenRequestDays } from '@/lib/requestDays';
import { deploymentSchoolName } from '@/lib/schoolLocations';
import { RequestData, TeacherData } from '@/types/models';
import { ClassContinuityNotice } from './ClassContinuityNotice';

interface RequestCandidatesProps {
  request: RequestData;
  candidates: TeacherData[];
  matching: boolean;
  error?: string | null;
  onAssign: (teacher: TeacherData) => void;
  onManualAssign: () => void;
}

export function RequestCandidates({ request, candidates, matching, error, onAssign, onManualAssign }: RequestCandidatesProps) {
  const days = getOpenRequestDays(request, request.assignments);
  const requiredHours = days.reduce((sum, day) => sum + day.hours, 0);
  const orderedCandidates = [...candidates.filter(candidate => !candidate.isOvertime), ...candidates.filter(candidate => candidate.isOvertime)];
  return <section aria-label="Besetzungsvorschläge für den ausgewählten Bedarf" className="space-y-4">
    <div className="sticky top-0 z-10 -mx-3 border-b border-primary/20 bg-card px-3 py-3">
      <p className="text-xs font-medium text-primary">Ausgewählter Bedarf</p>
      <h2 className="mt-1 break-words text-base font-semibold">{deploymentSchoolName(request)}{request.className ? ` · Klasse ${request.className}` : ''}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Ab {new Date(days[0]?.date ?? request.date).toLocaleDateString('de-DE')} · {request.substitutedTeacher || 'Vertretene Lehrkraft nicht angegeben'}</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-base font-semibold"><UsersRound className="size-4 text-primary" />Passende Lehrkräfte</h3>
      <Button variant="outline" size="sm" disabled={matching || !!error} onClick={onManualAssign}>Manuell auswählen</Button>
    </div>
    {error ? <p role="status" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Die Vorschläge sind momentan nicht verfügbar. Bitte aktualisieren Sie die Daten oder starten Sie die Suche erneut.</p>
      : matching ? <p role="status" className="py-4 text-sm text-muted-foreground">Passende Lehrkräfte werden gesucht …</p>
      : orderedCandidates.length === 0 ? <p role="status" className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Für diesen Bedarf ist aktuell keine passende Mobile Reserve verfügbar.</p>
      : <div className="divide-y divide-border">
        {orderedCandidates.map(candidate => {
          const hours = candidate.availableHoursByDate
            ? days.reduce((sum, day) => sum + Math.min(day.hours, candidate.availableHoursByDate?.[day.date] ?? 0), 0)
            : null;
          return <article key={candidate.id} className="space-y-3 py-4 first:pt-0">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-medium text-primary">{candidate.name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('')}</span>
              <div className="min-w-0 flex-1">
                <h4 className="break-words font-semibold">{candidate.name}</h4>
                <p className="mt-1 break-words text-xs text-muted-foreground">{candidate.qualifications || 'Keine Qualifikation hinterlegt'}</p>
              </div>
              {candidate.isOvertime && <Badge className="shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Mehrarbeit</Badge>}
            </div>
            {hours !== null && <Badge variant="secondary" className={hours >= requiredHours ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}>
              {hours >= requiredHours ? `Alle ${requiredHours} offenen Std. abdeckbar` : `${hours} von ${requiredHours} offenen Std. abdeckbar`}
            </Badge>}
            <ClassContinuityNotice continuity={candidate.classContinuity} />
            {candidate.hasConflict && <p className="text-sm text-amber-800 dark:text-amber-300">Terminkonflikt{candidate.conflictDates?.length ? `: ${candidate.conflictDates.map(date => new Date(date).toLocaleDateString('de-DE')).join(', ')}` : ''}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              {candidate.distanceToSchool != null && <span className="inline-flex items-center gap-1"><Navigation className="size-3.5" />{candidate.distanceToSchool.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km</span>}
              <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />Bis zu {candidate.assignedHours}/{candidate.maxWeeklyHours} Std. je Einsatzwoche belegt</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{candidate.eligibleDateKeys ? `${candidate.eligibleDateKeys.length} ${candidate.eligibleDateKeys.length === 1 ? 'möglicher Einsatztag' : 'mögliche Einsatztage'}` : 'Tage und Stunden im nächsten Schritt wählen'}</p>
              <Button onClick={() => onAssign(candidate)} aria-label={`${candidate.name} zuweisen`} variant={candidate.isOvertime ? 'outline' : 'default'}>Zuweisen</Button>
            </div>
          </article>;
        })}
      </div>}
    <details className="text-xs text-muted-foreground">
      <summary className="min-h-11 cursor-pointer py-3">Wie entstehen die Vorschläge?</summary>
      <p className="pb-2 leading-relaxed">Verfügbarkeit, Schulart, Auslastung und Entfernung fließen in die Empfehlung ein. Bei längerfristigem Bedarf werden auch Einsätze für {request.className ? `Klasse ${request.className}` : 'diesen Bedarf'} in der Kalenderwoche vor dem ersten vorgeschlagenen Einsatztag berücksichtigt.</p>
    </details>
  </section>;
}
