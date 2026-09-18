"use client";

import { useEffect, useState } from 'react';
import { Download, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { toLocalDateInputValue } from '@/lib/dateKey';
import { getSchoolYearForDate } from '@/lib/schoolYear';
import {
  calculateReportTotals, governmentReportInputSchema, reportingCategories, reportingStates, reportPositions,
  type GovernmentReportInput, type ReportingRow, type ReportingSetting, type ReportingState,
} from '@/lib/governmentReport';

interface ReportResponse {
  rows: ReportingRow[];
  saved: { input: GovernmentReportInput; updatedAt: string } | null;
  history: string[];
}
const fieldClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-70';
const formatDate = (date: string) => date.split('-').reverse().join('.');

export function GovernmentReportPanel({ schoolYear }: { schoolYear: string }) {
  const [date, setDate] = useState(() => getSchoolYearForDate(new Date()) === schoolYear ? toLocalDateInputValue() : `${schoolYear.slice(0, 4)}-09-01`);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [rows, setRows] = useState<ReportingRow[]>([]);
  const [office, setOffice] = useState('');
  const [internalShort, setInternalShort] = useState('');
  const [internalLong, setInternalLong] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const confirmDiscard = useUnsavedChanges(dirty);
  const minDate = `${schoolYear.slice(0, 4)}-09-01`, maxDate = `${schoolYear.slice(5)}-08-31`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/schulamt/government-reports?date=${date}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Laden fehlgeschlagen.');
        if (controller.signal.aborted) return;
        const payload = result as ReportResponse;
        setData(payload);
        const saved = payload.saved?.input;
        setRows(saved ? saved.entries.map(entry => {
          const source = payload.rows.find(row => row.teacherId === entry.teacherId);
          return { ...entry, name: source?.name ?? 'Nicht mehr vorhandene Lehrkraft', notes: [], suggestedState: entry.state, configuredFrom: null };
        }) : payload.rows);
        setOffice(saved?.office ?? '');
        setInternalShort(saved?.internalShort == null ? '' : String(saved.internalShort));
        setInternalLong(saved?.internalLong == null ? '' : String(saved.internalLong));
        setReviewed(saved?.reviewed ?? false);
        setLocked(Boolean(saved)); setDirty(false); setError(''); setLoading(false);
      })
      .catch((err: Error) => { if (!controller.signal.aborted) { setError(err.message); setLoading(false); setData(null); } });
    return () => controller.abort();
  }, [date, reload]);

  const change = () => { setDirty(true); setReviewed(false); setMessage(''); };
  const changeDate = (value: string) => {
    if (!value || value < minDate || value > maxDate || value === date || !confirmDiscard()) return;
    setLoading(true); setError(''); setMessage(''); setDate(value); setSearch('');
  };
  const changeSetting = (id: string, patch: Partial<ReportingSetting>) => {
    change(); setRows(current => current.map(row => row.teacherId === id ? { ...row, setting: { ...row.setting, ...patch } } : row));
  };
  const totals = calculateReportTotals(rows);
  const missing = rows.filter(row => row.setting.category === 'UNKNOWN').length;
  const canReview = missing === 0 && office.trim() && internalShort !== '' && internalLong !== '';
  const input: GovernmentReportInput = {
    date, office, internalShort: internalShort === '' ? null : Number(internalShort), internalLong: internalLong === '' ? null : Number(internalLong),
    reviewed, expectedUpdatedAt: data?.saved?.updatedAt ?? null,
    entries: rows.map(({ teacherId, setting, state }) => ({ teacherId, setting, state })),
  };

  async function save() {
    const parsed = governmentReportInputSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || 'Bitte Eingaben prüfen.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/schulamt/government-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Speichern fehlgeschlagen.');
      setData(current => current ? { ...current, saved: { input: parsed.data, updatedAt: result.updatedAt }, history: [...new Set([date, ...current.history])].sort().reverse() } : current);
      setDirty(false); setLocked(true);
      setMessage(reviewed ? 'Geprüfte Meldung gespeichert. Der Excel-Export steht bereit.' : 'Entwurf gespeichert. Vor dem Export bitte vervollständigen und prüfen.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  }

  async function download() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/schulamt/government-reports/export?date=${date}&revision=${encodeURIComponent(data?.saved?.updatedAt ?? '')}`);
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Export fehlgeschlagen.'); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `MR_Regierung_${date}.xlsx`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Export fehlgeschlagen.'); }
    finally { setBusy(false); }
  }

  async function editSaved(recalculate: boolean) {
    if (!data?.saved) return;
    if (recalculate) {
      if (!window.confirm('Einsatzdaten und MR-Angaben neu aus der App übernehmen? Die gespeicherte Meldung wird erst beim erneuten Speichern ersetzt.')) return;
      setBusy(true); setError('');
      try {
        const response = await fetch(`/api/schulamt/government-reports?date=${date}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Laden fehlgeschlagen.');
        const fresh = result as ReportResponse;
        if (fresh.saved?.updatedAt !== data.saved.updatedAt) throw new Error('Die gespeicherte Meldung wurde geändert. Bitte neu laden.');
        setRows(fresh.rows); setData(fresh);
      } catch (err) { setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen.'); return; }
      finally { setBusy(false); }
    } else {
      setRows(current => current.map(row => ({ ...row, setting: { ...row.setting, effectiveFrom: date } })));
    }
    setLocked(false); change();
  }

  return <div className="space-y-6 max-w-7xl">
    <p className="text-muted-foreground">Vertretungssituation an Grund- und Mittelschulen. Bestand und Einsätze am gewählten Stichtag prüfen und im Format der Regierung exportieren.</p>
    <div className="rounded-xl border border-border bg-card p-5 flex flex-wrap items-end gap-4">
      <label className="space-y-2 text-sm font-medium">Stichtag
        <input type="date" aria-label="Stichtag" className={fieldClass} min={minDate} max={maxDate} value={date} disabled={busy} onChange={e => changeDate(e.target.value)} />
      </label>
      <label className="space-y-2 text-sm font-medium">Gespeicherte Meldungen
        <select aria-label="Gespeicherte Meldungen" className={fieldClass} value="" disabled={busy || loading} onChange={e => changeDate(e.target.value)}>
          <option value="">Stichtag auswählen …</option>
          {data?.history.filter(d => d >= minDate && d <= maxDate).map(d => <option key={d} value={d}>{formatDate(d)}</option>)}
        </select>
      </label>
      <Button variant="outline" disabled={busy || loading} onClick={() => { if (confirmDiscard()) { setLoading(true); setReload(r => r + 1); } }}><RefreshCw className="size-4" />Neu laden</Button>
      {locked && <span className="text-sm text-muted-foreground">{reviewed ? 'Geprüfte Meldung' : 'Gespeicherter Entwurf'} · {data?.saved && new Date(data.saved.updatedAt).toLocaleString('de-DE')}</span>}
    </div>
    {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">{message}</p>}
    {loading ? <p role="status">Meldung wird geladen …</p> : !data ? <Button onClick={() => { setLoading(true); setReload(r => r + 1); }}>Erneut versuchen</Button> : <>
      {locked && <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1">Gespeicherter Stand. Spätere Änderungen an Einsätzen verändern diese Meldung nicht.</p>
        <Button variant="outline" disabled={busy} onClick={() => void editSaved(false)}>Meldung bearbeiten</Button>
        <Button variant="outline" disabled={busy} onClick={() => void editSaved(true)}>Neu aus App berechnen</Button>
      </div>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.65fr)]">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold mb-4">Meldewerte</h2>
          {missing > 0 && <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">Vorläufig: {missing} Lehrkräfte sind noch nicht zugeordnet und fehlen in den Summen.</p>}
          <dl className="divide-y divide-border">
            {reportPositions.map(([position, label, key]) => <div key={position} className="flex items-center justify-between gap-4 py-3 text-sm">
              <dt><span className="inline-block w-8 font-semibold">{position}</span>{label}</dt><dd className="font-semibold tabular-nums text-lg">{Number.isFinite(totals[key]) ? totals[key].toLocaleString('de-DE') : '–'}</dd>
            </div>)}
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-lg font-semibold">Angaben des Schulamts</h2>
          <label className="block space-y-2 text-sm">Schulamtskürzel
            <input className={fieldClass} value={office} maxLength={100} placeholder="z. B. UAM" disabled={locked || busy} onChange={e => { change(); setOffice(e.target.value); }} />
          </label>
          <p className="text-sm text-muted-foreground">Über schulhausinterne Maßnahmen versorgte Klassen. Bitte die ermittelten Zahlen eintragen, auch wenn es 0 sind.</p>
          <label className="block space-y-2 text-sm">6a – kurzfristig versorgte Klassen
            <input type="number" className={fieldClass} min={0} max={100000} step={1} value={internalShort} disabled={locked || busy} onChange={e => { change(); setInternalShort(e.target.value); }} />
          </label>
          <label className="block space-y-2 text-sm">6b – langfristig versorgte Klassen
            <input type="number" className={fieldClass} min={0} max={100000} step={1} value={internalLong} disabled={locked || busy} onChange={e => { change(); setInternalLong(e.target.value); }} />
          </label>
        </section>
      </div>
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3"><h2 className="text-lg font-semibold">Lehrkräfte prüfen <span className="text-muted-foreground font-normal">({rows.length})</span></h2>
          <input type="search" aria-label="Lehrkräfte suchen" placeholder="Lehrkraft suchen …" className={`${fieldClass} sm:max-w-xs`} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground">Nur GS-/MS-Lehrkräfte zählen. „Im MR-Bestand“ ab dauerhafter Nichtverfügbarkeit abwählen; kurzzeitig Erkrankte bleiben enthalten. Mobile Wochenstunden sind die maximalen MR-Stunden nach Abzug eines Festeinsatzes.</p>
        <p className="text-sm text-muted-foreground">Lehrkraftart, Bestand und Stunden gelten ab dem angegebenen Datum auch für spätere Meldungen. Bei Rückkehr einen neuen Stand mit „Im MR-Bestand“ und dem Rückkehrdatum speichern. Einsatzstatus gilt nur für diese Meldung. Jede Person wird genau einmal gezählt.</p>
        {!locked && missing > 0 && <Button variant="outline" disabled={busy} onClick={() => { change(); setRows(current => current.map(row => row.setting.category === 'UNKNOWN' ? { ...row, setting: { ...row.setting, category: 'GS_MS' } } : row)); }}>Nicht zugeordnete Lehrkräfte als GS / MS markieren</Button>}
        {rows.length === 0 && <p className="text-sm">Für dieses Schuljahr sind keine freigegebenen Lehrkräfte vorhanden.</p>}
        <div className="space-y-3">
          {rows.filter(row => row.name.toLocaleLowerCase('de-DE').includes(search.toLocaleLowerCase('de-DE'))).map(row => {
            const counted = row.setting.category === 'GS_MS' && row.setting.included;
            return <fieldset key={row.teacherId} disabled={locked || busy} className="rounded-lg border border-border p-4 space-y-3">
              <legend className="px-1 text-sm font-semibold">{row.name}</legend>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
                <label className="text-xs space-y-1 xl:col-span-2">Lehrkraftart
                  <select className={fieldClass} value={row.setting.category} onChange={e => changeSetting(row.teacherId, { category: e.target.value as ReportingSetting['category'] })}>
                    {Object.entries(reportingCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="text-xs space-y-1 xl:col-span-2">Max. mobile Wochenstunden
                  <input type="number" className={fieldClass} min={0} max={60} step={0.5} value={Number.isNaN(row.setting.weeklyHours) ? '' : row.setting.weeklyHours} onChange={e => changeSetting(row.teacherId, { weeklyHours: e.target.value === '' ? NaN : Number(e.target.value) })} />
                </label>
                <label className="text-xs space-y-1 xl:col-span-2">Angaben gültig ab
                  <input type="date" className={fieldClass} min={minDate} max={date} value={row.setting.effectiveFrom} onChange={e => changeSetting(row.teacherId, { effectiveFrom: e.target.value })} />
                </label>
                <label className="flex items-center gap-2 text-sm self-center xl:col-span-2"><input type="checkbox" checked={row.setting.included} onChange={e => changeSetting(row.teacherId, { included: e.target.checked })} />Im MR-Bestand</label>
                <label className="text-xs space-y-1 sm:col-span-2 xl:col-span-4">Einsatzstatus am Stichtag
                  <select className={fieldClass} disabled={!counted} value={row.state} onChange={e => { change(); setRows(current => current.map(r => r.teacherId === row.teacherId ? { ...r, state: e.target.value as ReportingState } : r)); }}>
                    {Object.entries(reportingStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">{counted ? `Zählt in 1a und mit ${Number.isFinite(row.setting.weeklyHours) ? row.setting.weeklyHours.toLocaleString('de-DE') : '–'} Stunden in 1b.` : row.setting.category === 'UNKNOWN' ? 'Zuordnung fehlt.' : 'Wird in dieser Meldung nicht mitgezählt.'}
                {row.configuredFrom && ` Hinterlegte Angaben seit ${formatDate(row.configuredFrom)}.`}
                {!locked && row.state !== row.suggestedState && ` Einsatzstatus manuell angepasst (Vorschlag: ${reportingStates[row.suggestedState]}).`}
              </p>
              {!locked && row.notes.length > 0 && <p className="text-xs text-muted-foreground">{row.notes.join(' ')}</p>}
            </fieldset>;
          })}
        </div>
      </section>
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm text-muted-foreground">Langfristig bedeutet mehr als 28 Kalendertage. Fest geplante längere Zuweisungen zählen sofort, offene Einsätze erst nach Überschreiten der vier Wochen. Bereits bekannte längere Dauer kann über den Einsatzstatus bestätigt werden. Vorschläge und Einsatzfähigkeit bitte am Stichtag prüfen.</p>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={reviewed} disabled={locked || busy || !canReview} onChange={e => { setReviewed(e.target.checked); setDirty(true); setMessage(''); }} />Ich habe Bestand, mobile Wochenstunden, Einsatzzuordnung und Klassenangaben für diesen Stichtag geprüft.</label>
        <div className="flex flex-wrap gap-3">
          {!locked && <Button disabled={busy} onClick={() => void save()}><Save className="size-4" />{busy ? 'Wird gespeichert …' : reviewed ? 'Geprüfte Meldung speichern' : 'Entwurf speichern'}</Button>}
          <Button variant="outline" disabled={busy || !locked || !reviewed || dirty} onClick={() => void download()}><Download className="size-4" />Excel für Regierung</Button>
        </div>
      </div>
    </>}
  </div>;
}
