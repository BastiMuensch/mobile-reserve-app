import { formatQualificationList } from '@/lib/teacherQualifications';
import { Clock, History, Navigation, UsersRound } from 'lucide-react';
import { shortHistoryDay, type PreviousTeacher } from '@/lib/requestAssignmentHistory';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getOpenRequestDays } from '@/lib/requestDays';
import { RequestData, TeacherData } from '@/types/models';
import { ClassContinuityNotice } from './ClassContinuityNotice';
import { suitabilityOrder } from '@/lib/matchingSuitability';

interface RequestCandidatesProps {
  request: RequestData;
  candidates: TeacherData[];
  matching: boolean;
  error?: string | null;
  onAssign: (teacher: TeacherData) => void;
  onManualAssign: () => void;
  /** People already deployed for this demand or class this school year. */
  previousTeachers?: PreviousTeacher[];
}

export function RequestCandidates({ request, candidates, matching, error, onAssign, onManualAssign, previousTeachers = [] }: RequestCandidatesProps) {
  const previousById = new Map(previousTeachers.map(person => [person.teacherId, person]));
  const days = getOpenRequestDays(request, request.assignments);
  const requiredHours = days.reduce((sum, day) => sum + day.hours, 0);
  const orderedCandidates = [...candidates].sort((a, b) => suitabilityOrder(a.suitability) - suitabilityOrder(b.suitability) || Number(a.isOvertime) - Number(b.isOvertime));
  return <section aria-label="Besetzungsvorschläge für den ausgewählten Bedarf" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-base font-semibold"><UsersRound className="size-4 text-primary" />Lehrkräfte für diesen Bedarf</h3>
      <Button variant="outline" size="sm" disabled={matching || !!error} onClick={onManualAssign}>Manuell auswählen</Button>
    </div>
    {error ? <p role="status" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Die Vorschläge sind momentan nicht verfügbar. Bitte aktualisieren Sie die Daten oder starten Sie die Suche erneut.</p>
      : matching ? <p role="status" className="py-4 text-sm text-muted-foreground">Passende Lehrkräfte werden gesucht …</p>
      : orderedCandidates.length === 0 ? <p role="status" className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Für diesen Bedarf ist aktuell keine passende Mobile Reserve verfügbar.</p>
      : <div className="divide-y divide-border">
        {orderedCandidates.map(candidate => {
          const fallback = candidate.suitability && candidate.suitability.level !== 'MATCH';
          // Reasons already explained in the fallback box are not repeated below it.
          const shownInFallback = new Set(fallback ? candidate.suitability?.reasons : []);
          const otherReasons = (candidate.matchReasons ?? []).filter(reason => !shownInFallback.has(reason));
          const hours = candidate.availableHoursByDate
            ? days.reduce((sum, day) => sum + Math.min(day.hours, candidate.availableHoursByDate?.[day.date] ?? 0), 0)
            : null;
          const previous = previousById.get(candidate.id);
          return <article key={candidate.id} className={`space-y-2 py-3 first:pt-0 ${previous ? '-mx-2 rounded-lg bg-primary/5 px-2 ring-1 ring-primary/25' : ''}`}>
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-medium text-primary">{candidate.name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('')}</span>
              <div className="min-w-0 flex-1">
                <h4 className="break-words font-semibold">{candidate.name}</h4>
                {previous && <Badge className="mt-1 gap-1 bg-primary text-primary-foreground"><History className="size-3" aria-hidden="true" />{request.className ? `War in Klasse ${request.className}` : 'War bei diesem Bedarf'} · zuletzt {shortHistoryDay(previous.lastDate)}</Badge>}
                <p className="mt-1 break-words text-xs text-muted-foreground">{formatQualificationList(candidate.qualifications) || 'Keine Qualifikation hinterlegt'}</p>
              </div>
              {candidate.isOvertime && <Badge className="shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Mehrarbeit</Badge>}
            </div>
            {fallback && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">Ausweichbesetzung · fachliche Prüfung erforderlich</p><p className="mt-1">{candidate.suitability?.reasons.join(' · ')}</p></div>}
            {otherReasons.length ? <p className="text-xs leading-relaxed text-muted-foreground">{otherReasons.join(' · ')}</p> : null}
            {/* Only real class history is worth a line; "none found" is the normal case. */}
            {candidate.classContinuity?.days ? <ClassContinuityNotice continuity={candidate.classContinuity} /> : null}
            {candidate.hasConflict && <p className="text-sm text-amber-800 dark:text-amber-300">Terminkonflikt{candidate.conflictDates?.length ? `: ${candidate.conflictDates.map(date => new Date(date).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })).join(', ')}` : ''}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                {hours !== null && <Badge variant="secondary" className={hours >= requiredHours ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}>
                  {hours >= requiredHours ? `Alle ${requiredHours} Std. abdeckbar` : `${hours} von ${requiredHours} Std. abdeckbar`}
                </Badge>}
                {candidate.distanceToSchool != null && <span className="inline-flex items-center gap-1" title="Entfernung Wohnort – Einsatzschule"><Navigation className="size-3.5" />{candidate.distanceToSchool.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km</span>}
                <span className="inline-flex items-center gap-1" title="Bereits belegte Stunden in der Einsatzwoche"><Clock className="size-3.5" />{candidate.assignedHours}/{candidate.maxWeeklyHours} Std./Woche</span>
              </div>
              <Button onClick={() => onAssign(candidate)} aria-label={`${candidate.name} ${fallback ? 'als Ausweichbesetzung prüfen' : 'zuweisen'}`} variant={fallback || candidate.isOvertime ? 'outline' : 'default'}>{fallback ? 'Ausweichbesetzung prüfen' : 'Zuweisen'}</Button>
            </div>
          </article>;
        })}
      </div>}
    <details className="text-xs text-muted-foreground">
      <summary className="min-h-11 cursor-pointer py-3">Wie entstehen die Vorschläge?</summary>
      <p className="pb-2 leading-relaxed">Zuerst zählt die fachliche Eignung für Schulart, Jahrgangsstufe und benötigtes Fach. Unter passenden Lehrkräften werden Stammschule, bekannte Klasse, zusammenhängende Einsätze und Entfernung berücksichtigt; Mehrarbeit wird nachrangig angeboten. Fachliche Abweichungen benötigen Ihre ausdrückliche Bestätigung. Einsätze für {request.className ? `Klasse ${request.className}` : 'diesen Bedarf'} in der Vorwoche werden ebenfalls berücksichtigt.</p>
    </details>
  </section>;
}
