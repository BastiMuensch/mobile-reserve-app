'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { handleUnauthorized } from '@/lib/authClient';
import { toLocalDateInputValue } from '@/lib/dateKey';
import { mondayOf, shiftDateKey } from '@/lib/classContinuity';
import { emptyWorkload, workloadCsv, workloadFor, type WorkloadReport, type WorkloadTotals } from '@/lib/workload';

import { createWorkloadLoader, type WorkloadLoadState } from '@/lib/workloadClient';

const formatDate = (key: string) => new Date(key).toLocaleDateString('de-DE', { timeZone: 'UTC' });
const formatHours = (hours: number) => hours.toLocaleString('de-DE');

export function WorkloadOverview({ report, exportDisabled = false }: { report: WorkloadReport; exportDisabled?: boolean }) {
  const [start, end] = report.schoolYear.split('/');
  const min = `${start}-09-01`, max = `${end}-08-31`;
  const today = toLocalDateInputValue();
  const [date, setDate] = useState(today < min || today > max ? min : today);
  const [teacherId, setTeacherId] = useState('');
  const selectedTeacherId = report.teachers.some(teacher => teacher.id === teacherId) ? teacherId : '';
  const [history, setHistory] = useState<'months' | 'weeks'>('months');
  const teachers = useMemo(() => report.teachers.filter(t => !selectedTeacherId || t.id === selectedTeacherId), [report, selectedTeacherId]);
  const week = mondayOf(date);
  const weekStart = week < min ? min : week;
  const weekEnd = shiftDateKey(week, 6) > max ? max : shiftDateKey(week, 6);
  const monthLabel = new Date(date).toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const sum = (period: 'total' | 'month' | 'week') => teachers.reduce((total, teacher) => {
    const row = workloadFor(teacher, period, date);
    return { hours: total.hours + row.hours, accepted: total.accepted + row.accepted, pending: total.pending + row.pending, days: total.days + row.days };
  }, emptyWorkload());
  const download = (allPeriods: boolean) => {
    if (exportDisabled) return;
    const filtered = { ...report, teachers };
    const blob = new Blob([workloadCsv(filtered, allPeriods ? undefined : { date })], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Unterrichtsstunden_${report.schoolYear.replace('/', '-')}_${allPeriods ? 'alle-Zeitraeume' : date}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const hoursCell = (totals: WorkloadTotals) => <>
    <span className="font-semibold tabular-nums">{formatHours(totals.hours)}</span>
    <span className="mt-1 block text-xs font-normal text-muted-foreground">{formatHours(totals.accepted)} bestätigt · {formatHours(totals.pending)} offen</span>
  </>;
  return <Card className="min-w-0 border-border/70 bg-white dark:bg-card">
    <CardHeader>
      <CardTitle><h2 className="flex items-center gap-2"><Clock className="size-5 shrink-0 text-primary" aria-hidden="true" /> Unterrichtsstunden je Mobiler Reserve</h2></CardTitle>
      <p className="text-sm text-muted-foreground">Geplante Einsätze im Schuljahr {report.schoolYear}, einschließlich zukünftiger Zuweisungen. Bestätigungen sind keine Nachweise tatsächlich geleisteter Arbeitszeit. Stornierte Einsätze zählen nicht mit.</p>
    </CardHeader>
    <CardContent className="space-y-6">
      {report.retentionNotice && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{report.retentionNotice}</p>}
      <p className="text-xs text-muted-foreground">Stand der Stundenübersicht: {new Date(report.generatedAt).toLocaleString('de-DE', {timeZone: 'Europe/Berlin'})}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 text-sm font-medium">
          <label htmlFor="workload-date">Datum für Woche und Monat</label>
          <Input id="workload-date" aria-describedby="workload-date-help" type="date" min={min} max={max} value={date} onChange={event => { if (event.target.value >= min && event.target.value <= max) setDate(event.target.value); }} />
          <p id="workload-date-help" className="text-xs font-normal text-muted-foreground">Zeigt die Woche und den Monat, in denen dieses Datum liegt.</p>
        </div>
        <div className="space-y-2 text-sm font-medium">
          <label htmlFor="workload-teacher">Mobile Reserve</label>
          <select id="workload-teacher" className="h-10 w-full rounded-md border border-input bg-background px-3" value={selectedTeacherId} onChange={event => setTeacherId(event.target.value)}>
            <option value="">Alle Mobilen Reserven</option>
            {report.teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3" aria-live="polite">
        {([
          ['week', 'Ausgewählte Woche', `${formatDate(weekStart)}–${formatDate(weekEnd)}`],
          ['month', monthLabel, 'Ausgewählter Monat'],
          ['total', 'Gesamt im Schuljahr', report.schoolYear],
        ] as const).map(([period, label, detail]) => <div key={period} className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          <p className="my-3 text-3xl font-semibold tabular-nums">{formatHours(sum(period).hours)} <span className="text-sm font-normal text-muted-foreground">UStd.</span></p>
          <p className="text-xs text-muted-foreground">{formatHours(sum(period).accepted)} bestätigt · {formatHours(sum(period).pending)} Bestätigung offen</p>
        </div>)}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button className="h-auto min-h-10 whitespace-normal" variant="outline" onClick={() => download(false)} disabled={exportDisabled || !teachers.length}><Download className="size-4 shrink-0" /> Auswahl als CSV</Button>
        <Button className="h-auto min-h-10 whitespace-normal" variant="outline" onClick={() => download(true)} disabled={exportDisabled || !teachers.length}><Download className="size-4 shrink-0" /> Alle Wochen und Monate als CSV</Button>
      </div>
      <p className="text-xs text-muted-foreground">UStd. = Unterrichtsstunden, keine Zeitstunden. CSV-Dateien lassen sich in Excel öffnen und berücksichtigen die gewählte Reserve. „Gesamt“ umfasst das ausgewählte Schuljahr. Wochen an der Schuljahresgrenze werden auf dieses Schuljahr begrenzt.</p>
      <div className="space-y-3 sm:hidden" aria-label="Unterrichtsstunden je Reserve">
        {teachers.map(teacher => {
          const weekly = workloadFor(teacher, 'week', date);
          return <article key={teacher.id} className="rounded-xl border p-4">
            <h3 className="font-medium break-words">{teacher.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{teacher.school} · Wochenlimit {teacher.maxWeeklyHours} UStd.</p>
            <dl className="mt-4 space-y-3 text-sm">
              {([['Woche', weekly], ['Monat', workloadFor(teacher, 'month', date)], ['Schuljahr gesamt', teacher.total]] as const).map(([label, totals]) => <div key={label} className="flex items-start justify-between gap-3">
                <dt>{label}</dt><dd className="text-right">{hoursCell(totals)}</dd>
              </div>)}
            </dl>
            {weekly.hours > teacher.maxWeeklyHours && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{weekly.hours - teacher.maxWeeklyHours} UStd. über Wochenlimit</p>}
          </article>;
        })}
      </div>
      <div className="hidden overflow-x-auto sm:block" tabIndex={0} role="region" aria-label="Stundenvergleich aller ausgewählten Reserven">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Geplante Unterrichtsstunden pro Reserve, Woche, Monat und Schuljahr</caption>
          <thead className="border-b text-muted-foreground"><tr><th scope="col" className="py-3 pr-4 font-medium">Mobile Reserve</th><th scope="col" className="px-3 py-3 font-medium">Woche</th><th scope="col" className="px-3 py-3 font-medium">Monat</th><th scope="col" className="pl-3 py-3 font-medium">Schuljahr gesamt</th></tr></thead>
          <tbody>{teachers.map(teacher => {
            const weekly = workloadFor(teacher, 'week', date);
            return <tr key={teacher.id} className="border-b last:border-0">
              <th scope="row" className="min-w-44 py-4 pr-4 font-medium">{teacher.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{teacher.school} · Wochenlimit {teacher.maxWeeklyHours} UStd.</span></th>
              <td className="min-w-36 px-3 py-4">{hoursCell(weekly)}{weekly.hours > teacher.maxWeeklyHours && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">{weekly.hours - teacher.maxWeeklyHours} UStd. über Wochenlimit</span>}</td>
              <td className="min-w-36 px-3 py-4">{hoursCell(workloadFor(teacher, 'month', date))}</td>
              <td className="min-w-36 pl-3 py-4">{hoursCell(teacher.total)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!teachers.length && <p className="py-8 text-center text-sm text-muted-foreground">Keine Mobilen Reserven für dieses Schuljahr vorhanden.</p>}
      {selectedTeacherId && teachers[0] && <div className="space-y-3 border-t pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">Verlauf: {teachers[0].name}</h3>
          <div className="flex gap-2" aria-label="Aufteilung des Verlaufs">
            <Button size="sm" variant={history === 'months' ? 'default' : 'outline'} aria-pressed={history === 'months'} onClick={() => setHistory('months')}>Monate</Button>
            <Button size="sm" variant={history === 'weeks' ? 'default' : 'outline'} aria-pressed={history === 'weeks'} onClick={() => setHistory('weeks')}>Wochen</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground sm:hidden">Die Verlaufstabelle lässt sich seitlich verschieben.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Stundenverlauf der ausgewählten Reserve"><table className="w-full text-left text-sm">
          <thead><tr className="border-b text-muted-foreground"><th scope="col" className="py-2 font-medium">Zeitraum</th><th scope="col" className="p-2 font-medium">Geplant (UStd.)</th><th scope="col" className="p-2 font-medium">Bestätigt</th><th scope="col" className="p-2 font-medium">Bestätigung offen</th><th scope="col" className="p-2 font-medium">Einsatztage</th></tr></thead>
          <tbody>{teachers[0][history].map(row => <tr key={row.key} className="border-b last:border-0"><th scope="row" className="whitespace-nowrap py-3 pr-3 font-normal">{formatDate(row.start)}–{formatDate(row.end)}</th><td className="p-2 tabular-nums">{row.hours}</td><td className="p-2 tabular-nums">{row.accepted}</td><td className="p-2 tabular-nums">{row.pending}</td><td className="p-2 tabular-nums">{row.days}</td></tr>)}</tbody>
        </table></div>
        <p className="text-xs text-muted-foreground">Zeiträume ohne Einsätze haben 0 UStd. und werden im Verlauf ausgelassen.</p>
      </div>}
    </CardContent>
  </Card>;
}

export function WorkloadStatistics({ schoolYear, revision }: { schoolYear: string; revision: number }) {
  const [snapshot, setSnapshot] = useState<WorkloadLoadState | null>(null);
  const loaderRef = useRef<ReturnType<typeof createWorkloadLoader> | null>(null);
  useEffect(() => {
    const loader = createWorkloadLoader(schoolYear, setSnapshot, { onUnauthorized: handleUnauthorized });
    loaderRef.current = loader;
    return () => { loader.dispose(); loaderRef.current = null; };
  }, [schoolYear]);
  useEffect(() => { void loaderRef.current?.refresh(); }, [schoolYear, revision]);
  const current = snapshot?.schoolYear === schoolYear ? snapshot : null;
  const report = current?.report;
  return <div className="space-y-3" aria-busy={current?.loading ?? true}>
    {current?.error && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
      <p>{current.error}{report ? ' Angezeigt wird der zuletzt geladene Stand; Downloads sind bis zur Aktualisierung gesperrt.' : ''}</p>
      <Button className="mt-3" variant="outline" onClick={() => void loaderRef.current?.refresh()}>Erneut versuchen</Button>
    </div>}
    {current?.loading && <p role="status" className="text-sm text-muted-foreground">{report ? 'Stundenübersicht wird aktualisiert … Downloads sind gleich wieder verfügbar.' : 'Unterrichtsstunden werden geladen …'}</p>}
    {report && <WorkloadOverview key={schoolYear} report={report} exportDisabled={current.loading || !!current.error} />}
    {!current && <p role="status" className="text-muted-foreground">Unterrichtsstunden werden geladen …</p>}
  </div>;
}
