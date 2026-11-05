import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { deploymentSchoolName } from "@/lib/schoolLocations";
import { AssignFormData, RequestData, TeacherData } from "@/types/models";
import { selectedCompanionEntries } from "@/lib/companionRequests";

interface AssignModalProps {
  request?: RequestData | null;
  teacher?: TeacherData | null;
  assignModalOpen: boolean;
  setAssignModalOpen: (val: boolean) => void;
  assignData: AssignFormData | null;
  setAssignData: (val: AssignFormData | null) => void;
  handleAssignSubmit: (e: React.FormEvent) => void;
  isAssigning: boolean;
}

export function AssignModal({
  request,
  teacher,
  assignModalOpen,
  setAssignModalOpen,
  assignData,
  setAssignData,
  handleAssignSubmit,
  isAssigning
}: AssignModalProps) {
  const selectedAssignments = (assignData?.assignments ?? [])
    .filter(assignment => assignment.selected)
    .sort((a, b) => a.date.localeCompare(b.date));
  const companionOptions = (assignData?.companionRequests ?? []).map(option => ({
    ...option, entries: selectedCompanionEntries(option, assignData?.assignments ?? []),
  })).filter(option => option.entries.length > 0);
  const companionHours = companionOptions.filter(option => assignData?.selectedCompanionIds?.includes(option.requestId))
    .reduce((sum, option) => sum + option.entries.reduce((total, entry) => total + entry.hours, 0), 0);
  const assignedHours = selectedAssignments.reduce((sum, assignment) => sum + (Number(assignment.hours) || 0), 0) + companionHours;
  const cancelledHours = assignData?.reserveShortageMode
    ? selectedAssignments.reduce((sum, assignment) => sum + Math.max(0, (assignment.openHours ?? 0) - (Number(assignment.hours) || 0)), 0)
    : 0;
  const timetableConflicts = selectedAssignments.filter(assignment => assignment.timetableConflict);
  const availableCount = assignData?.assignments.length ?? 0;
  const selectedCount = selectedAssignments.length;
  const suitability = assignData?.suitability ?? teacher?.suitability;
  const needsSuitabilityConsent = Boolean(suitability && suitability.level !== 'MATCH');
  const formatDate = (date: string) => new Date(date).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });

  function selectPeriod(selected: boolean) {
    if (!assignData || isAssigning) return;
    setAssignData({
      ...assignData,
      assignments: assignData.assignments.map(assignment => ({ ...assignment, selected })),
      allowTimetableOverride: false,
    });
  }

  return (
    <Dialog open={assignModalOpen} onOpenChange={open => { if (!isAssigning) setAssignModalOpen(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]" showCloseButton={!isAssigning}>
        <DialogHeader>
          <DialogTitle>Einsatz zuweisen</DialogTitle>
          <DialogDescription>
            Prüfen Sie Lehrkraft, Einsatzort und Stunden. Sie können den Zeitraum gemeinsam zuweisen oder einzelne Tage auswählen.
          </DialogDescription>
        </DialogHeader>
        {(teacher || request) && <div className="space-y-2 rounded-lg bg-muted p-4">
          <p className="text-base font-semibold">{teacher?.name || 'Ausgewählte Lehrkraft'}</p>
          {request && <><p className="text-sm">{deploymentSchoolName(request)}{request.className ? ` · Klasse ${request.className}` : ''}</p><p className="text-sm text-muted-foreground">Vertretung für {request.substitutedTeacher || 'nicht angegebene Lehrkraft'}</p></>}
        </div>}
        <form onSubmit={handleAssignSubmit} className="space-y-4 py-4">
          {needsSuitabilityConsent && assignData && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            <p className="font-semibold">Fachliche Ausweichbesetzung</p>
            <p>{suitability?.reasons.join(' · ')}</p>
            <label className="flex cursor-pointer items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={assignData.allowSuitabilityOverride === true} disabled={isAssigning} onChange={event => setAssignData({ ...assignData, allowSuitabilityOverride: event.target.checked })} /><span>Ich habe die fachliche Eignung geprüft und bestätige diese Ausweichbesetzung ausdrücklich.</span></label>
          </div>}
          {cancelledHours > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status">
            <p className="font-semibold">{cancelledHours} Reststunden werden abgesagt.</p>
            <p className="mt-1">Die ausgewählten Tage werden abgeschlossen. Die Schule wird über die Teilbesetzung und die abgesagten Stunden informiert. Andere Tage bleiben offen.</p>
          </div>}
          <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div role="status" aria-live="polite">
              <p className="font-semibold">{selectedCount} von {availableCount} Einsatztagen ausgewählt</p>
              {selectedCount > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {selectedCount === 1
                    ? formatDate(selectedAssignments[0].date)
                    : `${formatDate(selectedAssignments[0].date)} bis ${formatDate(selectedAssignments[selectedCount - 1].date)}`}
                  {selectedCount > 1 && ' · eine gemeinsame Zuweisung'}
                </p>
              ) : <p className="text-sm text-muted-foreground">Bitte wählen Sie mindestens einen Einsatztag aus.</p>}
            </div>
            {availableCount > 1 && <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => selectPeriod(true)} disabled={isAssigning || selectedCount === availableCount}>
                Gesamten Zeitraum auswählen
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => selectPeriod(false)} disabled={isAssigning || selectedCount === 0}>
                Auswahl aufheben
              </Button>
            </div>}
          </div>
          <div className="space-y-3">
            {assignData?.assignments.map((assignment, index) => {
               const d = new Date(assignment.date);
               const dayName = d.toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' });
               return (
                <div key={index} className="flex flex-wrap items-center gap-3 p-3 border border-border rounded-lg bg-muted/50 transition-colors hover:bg-muted">
                  <input
                    id={`assignment-selected-${index}`}
                    type="checkbox"
                    className="w-5 h-5 accent-primary rounded cursor-pointer"
                    checked={assignment.selected}
                    disabled={isAssigning}
                    onChange={(e) => {
                      const newAssignments = assignData.assignments.map((a, i) =>
                        i === index ? { ...a, selected: e.target.checked } : a
                      );
                      setAssignData({...assignData, assignments: newAssignments, allowTimetableOverride: false});
                    }}
                    aria-label={`${dayName}, ${formatDate(assignment.date)} zuweisen`}
                  />
                  <div className={`min-w-0 flex-1 basis-32 font-medium ${!assignment.selected ? 'text-muted-foreground line-through' : ''}`}>
                    {dayName}, {formatDate(assignment.date)}
                    {assignment.timetableConflict && <p className="text-xs font-normal text-amber-700 dark:text-amber-300">Abweichender Einsatztag oder Stundenplan</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      required
                      step="1"
                      min="1"
                      max={assignment.openHours ?? 10}
                      className="w-20"
                      value={assignment.hours}
                      disabled={!assignment.selected || isAssigning}
                      aria-label={`Stunden für ${dayName}, ${formatDate(assignment.date)}`}
                      onChange={(e) => {
                        const newAssignments = assignData.assignments.map((a, i) =>
                        i === index ? { ...a, hours: e.target.value, timetableConflict: a.availableHours === undefined ? a.timetableConflict : Number(e.target.value) > a.availableHours } : a
                      );
                        setAssignData({...assignData, assignments: newAssignments, allowTimetableOverride: false});
                      }}
                    />
                    <span className="text-sm text-muted-foreground">Std.</span>
                  </div>
                </div>
              );
            })}
          </div>
          {companionOptions.length > 0 && assignData && <fieldset className="space-y-3 rounded-lg border border-primary/30 p-3">
            <legend className="px-1 text-sm font-semibold">Passende Bedarfe gemeinsam besetzen</legend>
            <p className="text-sm text-muted-foreground">Diese Reserve kann am selben Standort auch folgende Vertretungen übernehmen. Die Ausfallmeldungen bleiben getrennt.</p>
            {companionOptions.map(option => <label key={option.requestId} className="flex items-start gap-3 rounded-md bg-muted/50 p-3">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" disabled={isAssigning}
                checked={assignData.selectedCompanionIds?.includes(option.requestId) ?? false}
                onChange={event => setAssignData({ ...assignData, selectedCompanionIds: event.target.checked
                  ? [...(assignData.selectedCompanionIds ?? []), option.requestId]
                  : (assignData.selectedCompanionIds ?? []).filter(id => id !== option.requestId) })} />
              <span className="min-w-0 text-sm">
                <span className="font-semibold">Vertretung für {option.substitutedTeacher}{option.className ? ` · Klasse ${option.className}` : ''}</span>
                {option.entries.map(entry => <span key={entry.date} className="mt-1 block text-muted-foreground">
                  {formatDate(entry.date)} · {entry.hours} Std. · Unterrichtsstunden {(JSON.parse(entry.lessonHours) as number[]).join(', ')}
                </span>)}
                {option.isOvertime && <span className="mt-1 block text-amber-700 dark:text-amber-300">Mit dieser Ergänzung kann das Wochenlimit überschritten werden.</span>}
              </span>
            </label>)}
          </fieldset>}
          <p className="text-xs text-muted-foreground">Auch bei einem kurzen Einsatz bleibt die Reserve für diesen Tag an diesen Schulstandort gebunden. Weitere Bedarfe dort sind nur ohne Stundenüberschneidung möglich.</p>
          {assignData?.reserveShortageMode && selectedAssignments.some(a => (a.openHours ?? 0) > Number(a.hours)) && (
            <p className="text-sm text-muted-foreground">Reststunden werden abgesagt: {selectedAssignments.filter(a => (a.openHours ?? 0) > Number(a.hours)).map(a => `${formatDate(a.date)}: ${(a.openHours ?? 0) - Number(a.hours)} Std.`).join(' · ')}</p>
          )}
          {timetableConflicts.length > 0 && assignData && (
            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <p role="status">Die gewählten Einsatztage oder Unterrichtsstunden weichen vom regulären Einsatzplan ab. Nach Absprache ist eine manuelle Zuweisung trotzdem möglich.</p>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  checked={assignData.allowTimetableOverride === true}
                  disabled={isAssigning}
                  onChange={event => setAssignData({ ...assignData, allowTimetableOverride: event.target.checked })}
                />
                <span>Ich bestätige die manuelle Ausnahme für die gewählten Tage.</span>
              </label>
            </div>
          )}
          <DialogFooter className="pt-4 border-t border-border">
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md" disabled={isAssigning || selectedCount === 0 || (needsSuitabilityConsent && !assignData?.allowSuitabilityOverride) || (timetableConflicts.length > 0 && !assignData?.allowTimetableOverride)}>
              {isAssigning ? 'Wird zugewiesen …' : `${assignedHours} Std. zuweisen${cancelledHours > 0 ? ` · ${cancelledHours} Std. absagen` : selectedCount > 1 ? ` · ${selectedCount} Tage` : ''}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
