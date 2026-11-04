"use client";

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { isCurrentQualificationType, QUALIFICATION_TYPES, type QualificationType, type TeacherQualificationDetails, type TeacherQualificationForm } from '@/lib/teacherQualifications';

/**
 * Fachrichtungen only appear when the office switched the Fachlehrkraft module on
 * (specialistFieldOptions non-empty) and the reserve is a Fachlehrkraft.
 */
export function TeacherQualificationFields({ value, onChange, specialistFieldOptions = [], specialistFields = [], onSpecialistFieldsChange, requireSpecialistField = false }: {
  value: TeacherQualificationDetails;
  onChange: (value: TeacherQualificationForm) => void;
  specialistFieldOptions?: string[];
  specialistFields?: string[];
  onSpecialistFieldsChange?: (fields: string[]) => void;
  /** Self-service forms ask for at least one Fachrichtung; Schulamt edits stay possible without. */
  requireSpecialistField?: boolean;
}) {
  const id = useId();
  const showSpecialistFields = value.qualificationType === 'SPECIALIST' && specialistFieldOptions.length > 0 && Boolean(onSpecialistFieldsChange);
  const selectedFields = new Set(specialistFields);
  const missingSpecialistField = showSpecialistFields && !specialistFieldOptions.some(field => selectedFields.has(field));
  const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return <fieldset className="min-w-0 space-y-3">
    <legend className="text-sm font-semibold">Qualifikation – Pflichtangaben</legend>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${id}-type`}>Qualifikationsstatus</Label>
        <select id={`${id}-type`} className={selectClass} required value={isCurrentQualificationType(value.qualificationType) ? value.qualificationType : ''}
          aria-describedby={`${id}-school-hint`}
          onChange={event => onChange({ qualificationType: event.target.value as QualificationType || null, canTeachSports: value.canTeachSports ?? null })}>
          <option value="" disabled>Bitte wählen</option>
          {Object.entries(QUALIFICATION_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <p id={`${id}-school-hint`} className="text-xs text-muted-foreground">GS = Grundschule · MS = Mittelschule</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-sports`}>Sport unterrichten</Label>
        <select id={`${id}-sports`} className={selectClass} required value={value.canTeachSports == null ? '' : String(value.canTeachSports)}
          aria-describedby={`${id}-qualification-hint`}
          onChange={event => onChange({ qualificationType: value.qualificationType ?? null, canTeachSports: event.target.value === '' ? null : event.target.value === 'true' })}>
          <option value="" disabled>Bitte wählen</option>
          <option value="true">Ja</option>
          <option value="false">Nein</option>
        </select>
      </div>
    </div>
    {showSpecialistFields && <fieldset className="min-w-0 space-y-2 rounded-lg border p-3" aria-describedby={`${id}-specialist-hint`}>
      <legend className="px-1 text-sm font-medium">Fachrichtung</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {specialistFieldOptions.map((field, index) => <label key={field} className="flex min-w-0 max-w-full items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={selectedFields.has(field)}
            required={requireSpecialistField && missingSpecialistField && index === 0}
            onChange={event => onSpecialistFieldsChange?.(event.target.checked
              ? specialistFieldOptions.filter(option => option === field || selectedFields.has(option))
              : specialistFields.filter(option => option !== field))} />
          <span className="min-w-0 [overflow-wrap:anywhere]">Fachlehrkraft {field}</span>
        </label>)}
      </div>
      <p id={`${id}-specialist-hint`} className="text-xs text-muted-foreground">Mehrfachauswahl möglich. Bei einem Bedarf für eine Fachlehrkraft werden passende Fachrichtungen zuerst vorgeschlagen.</p>
      {missingSpecialistField && !requireSpecialistField && <p className="text-xs text-amber-700 dark:text-amber-300">Noch keine Fachrichtung hinterlegt – bei Fachlehrkraft-Bedarfen erscheint diese Reserve nur als Ausweichbesetzung.</p>}
    </fieldset>}
    <p id={`${id}-qualification-hint`} className="text-xs text-muted-foreground">Sportunterricht darf erteilt werden, wenn die Lehrbefähigung vorliegt oder ein Übungsleiterschein vorhanden ist. Die Lehrkraftart wird bei Besetzungsvorschlägen berücksichtigt; die Sportangabe bei einem ausdrücklich gemeldeten Sportbedarf. Schulamt und Einsatzschule können diese Angaben einsehen.</p>
  </fieldset>;
}
