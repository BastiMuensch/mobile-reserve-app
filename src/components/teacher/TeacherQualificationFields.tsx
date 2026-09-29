"use client";

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { isCurrentQualificationType, QUALIFICATION_TYPES, type QualificationType, type TeacherQualificationDetails, type TeacherQualificationForm } from '@/lib/teacherQualifications';

export function TeacherQualificationFields({ value, onChange }: {
  value: TeacherQualificationDetails;
  onChange: (value: TeacherQualificationForm) => void;
}) {
  const id = useId();
  const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return <fieldset className="space-y-3">
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
    <p id={`${id}-qualification-hint`} className="text-xs text-muted-foreground">Sportunterricht darf erteilt werden, wenn die Lehrbefähigung vorliegt oder ein Übungsleiterschein vorhanden ist. Diese Angaben werden dem Schulamt und bei einer Zuweisung der jeweiligen Schule angezeigt. Sie haben keinen Einfluss auf die Zuteilung.</p>
  </fieldset>;
}
