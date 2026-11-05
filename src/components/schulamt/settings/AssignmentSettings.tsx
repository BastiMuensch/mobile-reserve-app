"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GraduationCap, Map as MapIcon, MessageSquare, Plus, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import type { TemplateSettingsForm } from "@/types/models";
import { DEFAULT_SPECIALIST_FIELDS, normalizeSpecialistField } from "@/lib/specialistFields";
import type { DistrictUsage } from "@/lib/schoolDistrict";

type Props = {
  settings: TemplateSettingsForm;
  /** Last saved values: merging may only target districts the server already knows. */
  savedSettings: TemplateSettingsForm;
  onChange: (settings: TemplateSettingsForm) => void;
  disabled: boolean;
};

const normalizeDistrict = (value: string) => value.trim().toLocaleUpperCase("de");

function Section({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return <section className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <div><h3 className="font-semibold leading-tight">{title}</h3><p className="text-sm text-muted-foreground">{description}</p></div>
    </div>
    <div className="space-y-5 sm:pl-11">{children}</div>
  </section>;
}

function Switch({ id, checked, onChange, disabled, label, help, details }: { id: string; checked: boolean; onChange: (checked: boolean) => void; disabled: boolean; label: string; help: string; details?: ReactNode }) {
  return <div className="space-y-1.5">
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm font-medium">
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}
        aria-describedby={`${id}-help`} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
      {label}
    </label>
    <div id={`${id}-help`} className="space-y-1 pl-7 text-sm text-muted-foreground">
      <p>{help}</p>
      {details && <details className="group"><summary className="cursor-pointer text-xs font-medium text-primary">Genauer erklärt</summary><div className="mt-2 space-y-2 text-xs leading-relaxed">{details}</div></details>}
    </div>
  </div>;
}

/** Editable list of short codes (Bezirke, Fachrichtungen) shown as removable chips. */
function ChipListEditor({ id, label, values, onChange, normalize, placeholder, disabled, maxLength, help }: {
  id: string; label: string; values: string[]; onChange: (values: string[]) => void; normalize: (value: string) => string;
  placeholder: string; disabled: boolean; maxLength: number; help?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = normalize(draft);
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft("");
  };
  return <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <div className="flex flex-wrap gap-2" aria-live="polite">
      {values.length === 0 && <span className="text-sm text-muted-foreground">Noch keine Einträge.</span>}
      {values.map(value => <span key={value} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-3 pr-1 text-sm font-medium text-primary">
        <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
        <button type="button" disabled={disabled} onClick={() => onChange(values.filter(item => item !== value))} aria-label={`${value} entfernen`}
          className="shrink-0 rounded-full p-0.5 hover:bg-primary/20 disabled:opacity-50"><X className="h-3.5 w-3.5" /></button>
      </span>)}
    </div>
    <div className="flex max-w-sm flex-col gap-2 sm:flex-row">
      <Input id={id} value={draft} maxLength={maxLength} placeholder={placeholder} disabled={disabled}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      <Button type="button" variant="outline" disabled={disabled || !draft.trim()} onClick={add}><Plus className="mr-1 h-4 w-4" />Hinzufügen</Button>
    </div>
    {help && <p className="text-xs text-muted-foreground">{help}</p>}
  </div>;
}

/** Spellings in use that are not in the saved list – merge them or adopt them. */
function DistrictCleanup({ settings, savedDistricts, onAdopt, disabled }: { settings: TemplateSettingsForm; savedDistricts: string[]; onAdopt: (value: string) => void; disabled: boolean }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [usage, setUsage] = useState<DistrictUsage[] | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState("");
  const listDirty = JSON.stringify(settings.schoolDistricts ?? []) !== JSON.stringify(savedDistricts);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/schulamt/districts", { cache: "no-store", signal });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.usage)) setUsage(data.usage);
    } catch { /* The overview is optional; saving the list still works. */ }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const unlisted = (usage ?? []).filter(entry => !savedDistricts.includes(entry.value));
  if (!usage || unlisted.length === 0) {
    return usage && savedDistricts.length > 0 ? <p className="text-sm text-emerald-700 dark:text-emerald-300">Alle gespeicherten Bezirksangaben entsprechen Ihrer Liste.</p> : null;
  }

  const merge = async (from: string) => {
    const to = targets[from] ?? "";
    if (!to) return;
    const entry = unlisted.find(item => item.value === from);
    const ok = await confirm({
      title: `„${from}“ in „${to}“ zusammenführen?`,
      description: `${entry?.schools ?? 0} Schule(n) und ${entry?.teachers ?? 0} Reserve-Eintrag/Einträge erhalten den Bezirk „${to}“. Das lässt sich nur durch erneutes Bearbeiten rückgängig machen.`,
      confirmLabel: "Zusammenführen",
    });
    if (!ok) return;
    setMerging(from);
    try {
      const response = await fetch("/api/schulamt/districts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Die Bezirke konnten nicht zusammengeführt werden.");
      setUsage(data.usage);
      toast({ variant: "success", title: `„${from}“ → „${to}“: ${data.schools} Schule(n), ${data.teachers} Reserve-Eintrag/Einträge angepasst.` });
      window.dispatchEvent(new Event("app-refresh"));
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : "Die Bezirke konnten nicht zusammengeführt werden." });
    } finally {
      setMerging("");
    }
  };

  return <div className="space-y-3 rounded-lg border border-amber-300/70 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
    <div>
      <p className="text-sm font-semibold">Abweichende Angaben ({unlisted.length})</p>
      <p className="text-xs text-muted-foreground">{savedDistricts.length === 0
        ? "Diese Bezirke sind bei Schulen und Reserven eingetragen. Übernehmen Sie die richtigen Schreibweisen in Ihre Liste und speichern Sie – danach können Sie Abweichungen hier zusammenführen."
        : "Diese Schreibweisen stehen nicht in Ihrer gespeicherten Liste. Führen Sie sie mit einem Listeneintrag zusammen oder nehmen Sie sie in die Liste auf."}</p>
    </div>
    <ul className="divide-y divide-amber-200/70 dark:divide-amber-500/20">
      {unlisted.map(entry => <li key={entry.value} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm">
        <span className="min-w-0 max-w-full font-mono font-semibold [overflow-wrap:anywhere]">{entry.value}</span>
        <span className="text-xs text-muted-foreground">{entry.schools} Schule(n) · {entry.teachers} Reserve(n)</span>
        <span className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {savedDistricts.length > 0 && <>
            <select aria-label={`Zielbezirk für ${entry.value}`} className="h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm" disabled={disabled || listDirty || Boolean(merging)}
              value={targets[entry.value] ?? ""} onChange={event => setTargets(current => ({ ...current, [entry.value]: event.target.value }))}>
              <option value="">zusammenführen in …</option>
              {savedDistricts.map(district => <option key={district} value={district}>{district}</option>)}
            </select>
            <Button type="button" size="sm" variant="outline" disabled={disabled || listDirty || !targets[entry.value] || Boolean(merging)} onClick={() => void merge(entry.value)}>
              <Scale className="mr-1 h-3.5 w-3.5" />{merging === entry.value ? "Läuft …" : "Zusammenführen"}
            </Button>
          </>}
          <Button type="button" size="sm" variant="ghost" disabled={disabled || (settings.schoolDistricts ?? []).includes(normalizeDistrict(entry.value))} onClick={() => onAdopt(entry.value)}>
            {(settings.schoolDistricts ?? []).includes(normalizeDistrict(entry.value)) ? "In Liste" : "In Liste aufnehmen"}
          </Button>
        </span>
      </li>)}
    </ul>
    {listDirty && savedDistricts.length > 0 && <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Bitte zuerst die geänderte Liste speichern, dann zusammenführen.</p>}
  </div>;
}

/** Schulamt settings that shape requests, reserve forms and assignments – grouped by topic. */
export function AssignmentSettings({ settings, savedSettings, onChange, disabled }: Props) {
  const districts = settings.schoolDistricts ?? [];
  const specialistFields = settings.specialistFields ?? [];
  const set = (patch: Partial<TemplateSettingsForm>) => onChange({ ...settings, ...patch });

  return <div className="space-y-8">
    <Section icon={<MessageSquare className="h-4 w-4" />} title="Bedarfsmeldung der Schulen" description="Was Schulen beim Melden eines Bedarfs angeben können.">
      <Switch id="request-urgency-note" checked={settings.requestUrgencyNoteEnabled === true} disabled={disabled}
        onChange={requestUrgencyNoteEnabled => set({ requestUrgencyNoteEnabled })}
        label="Nachrichten ans Schulamt erlauben"
        help="Schulen können zu einem Bedarf eine organisatorische Nachricht an das Schulamt senden und später ergänzen."
        details={<p>Ohne Freischaltung erscheint diese Option nicht in der Bedarfsmeldung. Nachrichten werden nicht an Mobile Reserven weitergegeben.</p>} />
      <div className="space-y-4">
        <Switch id="specialist-requests" checked={settings.specialistRequestsEnabled === true} disabled={disabled}
          onChange={enabled => set({ specialistRequestsEnabled: enabled, ...(enabled && specialistFields.length === 0 ? { specialistFields: [...DEFAULT_SPECIALIST_FIELDS] } : {}) })}
          label="Fachlehrkräfte gesondert abfragen"
          help="Schulen können zusätzlich „Fachlehrkraft“ (mit Fachrichtung) anfordern; Fachlehrkräfte geben ihre Fachrichtung an."
          details={<>
            <p>Ausgeschaltet gibt es für neue Bedarfe nur Grundschule und Mittelschule; Fachrichtungen werden in Profilformularen nicht mehr abgefragt. Bestehende Bedarfe und Qualifikationen bleiben erhalten und werden bei ihrer Besetzung weiter berücksichtigt.</p>
            <p>Bei einem Fachlehrkraft-Bedarf werden Fachlehrkräfte der passenden Fachrichtung zuerst vorgeschlagen. Sind keine frei, können Sie nach ausdrücklicher Bestätigung auch eine GS-/MS-Lehrkraft oder eine Fachlehrkraft anderer Fachrichtung einsetzen (Ausweichbesetzung). Der gemeinsame Besetzungsvorschlag plant nur passende Reserven ein.</p>
          </>} />
        {settings.specialistRequestsEnabled === true && <div className="ml-7 rounded-lg border bg-muted/30 p-4">
          <ChipListEditor id="specialist-field-input" label="Fachrichtungen" values={specialistFields} disabled={disabled} maxLength={40}
            normalize={normalizeSpecialistField} placeholder="z. B. E/G" onChange={values => set({ specialistFields: values })}
            help="Kurzbezeichnungen, wie Schulen und Reserven sie kennen. Entfernte Fachrichtungen bleiben bei bestehenden Bedarfen erhalten." />
        </div>}
      </div>
    </Section>

    <Section icon={<MapIcon className="h-4 w-4" />} title="Schulamtsbezirke" description="Einheitliche Bezirksangaben für Schulen und Reserven.">
      <ChipListEditor id="district-input" label="Bezirke Ihres Schulamts" values={districts} disabled={disabled} maxLength={50}
        normalize={normalizeDistrict} placeholder="z. B. BT" onChange={values => set({ schoolDistricts: [...values].sort((a, b) => a.localeCompare(b, "de")) })}
        help="Ist die Liste gefüllt, wird der Bezirk in Registrierung, Reserven- und Schulverwaltung aus einer Auswahl gewählt statt frei eingetippt. Leere Liste = Freitext wie bisher." />
      <DistrictCleanup settings={settings} savedDistricts={savedSettings.schoolDistricts ?? []} disabled={disabled}
        onAdopt={value => { const normalized = normalizeDistrict(value); if (!districts.includes(normalized)) set({ schoolDistricts: [...districts, normalized].sort((a, b) => a.localeCompare(b, "de")) }); }} />
      <Switch id="district-filter" checked={settings.schoolDistrictFilterEnabled === true} disabled={disabled}
        onChange={schoolDistrictFilterEnabled => set({ schoolDistrictFilterEnabled })}
        label="Bezirksfilter in den Übersichten anzeigen"
        help="Blendet einen Bezirksfilter in Übersicht, Reservenliste und Schulverwaltung ein. Bei den Reserven wird zusätzlich der eingetragene Bezirk angezeigt."
        details={<p>Zur Auswahl stehen die bei Ihren Schulen und Reserven eingetragenen Bezirke. Beim Ausschalten werden wieder alle Einträge angezeigt; die gespeicherten Bezirksangaben bleiben erhalten.</p>} />
    </Section>

    <Section icon={<GraduationCap className="h-4 w-4" />} title="Zuweisung" description="Wie Teilbesetzungen behandelt werden.">
      <Switch id="reserve-shortage" checked={settings.reserveShortageMode === true} disabled={disabled}
        onChange={reserveShortageMode => set({ reserveShortageMode })}
        label="Reststunden bei Teilzuweisung automatisch absagen"
        help="Übernimmt eine Reserve nur einen Teil eines Tagesbedarfs (z. B. 4 von 6 Stunden), werden die übrigen Stunden wegen Reservemangels abgesagt und die Schule informiert. Ausgeschaltet bleiben sie offen."
        details={<>
          <p>Gilt nach dem Speichern für neue Einzelzuweisungen und gemeinsame Besetzungsvorschläge. Abgesagte Stunden zählen nicht zur Arbeitszeit.</p>
          <p>Weitere unbesetzte Tage derselben Anfrage bleiben in beiden Fällen offen. Krankmeldungen und andere Abwesenheiten bleiben verbindlich. Wird ein Einsatz aufgehoben oder fällt die Reserve aus, wird sein Tagesbedarf einschließlich der abgesagten Reststunden wieder geöffnet.</p>
          <p>Das Umschalten verändert keine bereits gespeicherten Zuweisungen oder Absagen. Außerhalb regulärer Einsatztage ist weiterhin nur eine ausdrücklich bestätigte manuelle Zuweisung möglich.</p>
        </>} />
    </Section>
  </div>;
}
