'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSchulamtData } from '@/hooks/useSchulamtData';
import { useSchulamtYear } from '@/hooks/useSchulamtYear';
import { formatProofDate } from '@/lib/assignmentSeries';
import { dailyDeployments, isMultiDayDeployment, type DailyDeployment } from '@/lib/dailyDeploymentList';
import { handleUnauthorized } from '@/lib/authClient';
import { toLocalDateInputValue } from '@/lib/dateKey';

const columns = ['Einsatzschule', 'Vertretung für', 'Zeitraum', 'Mobile Reserve', 'Stammschule'];

function deploymentCells(row: DailyDeployment) {
  const start = formatProofDate(row.start);
  const period = row.openEnded ? `${start} -` : row.start === row.end ? start : `${start} – ${formatProofDate(row.end)}`;
  return [
    row.school,
    row.substitutedTeacher || 'Keine Angabe',
    period,
    <>{row.teacher}{row.pending && <span className="block text-xs text-muted-foreground">Bestätigung ausstehend</span>}</>,
    row.homeSchool ?? 'Keine Angabe',
  ];
}

function DeploymentGroup({ label, rows }: { label: string; rows: DailyDeployment[] }) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 font-semibold">{label}</h2>
      <ul className="divide-y divide-border md:hidden">
        {rows.map(row => (
          <li key={row.id} className="px-4 py-3">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {deploymentCells(row).map((value, index) => (
                <div key={columns[index]} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{columns[index]}</dt>
                  <dd className="wrap-break-word font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table aria-label={label} className="table-fixed">
          <TableHeader>
            <TableRow className="bg-muted/50">
              {columns.map(column => <TableHead key={column} scope="col" className="px-4 whitespace-normal">{column}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.id}>
                {deploymentCells(row).map((value, index) => (
                  <TableCell key={columns[index]} className="px-4 py-3 align-top whitespace-normal wrap-break-word">{value}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function DailyDeploymentView() {
  const { requests, teachers } = useSchulamtData();
  const { selectedYear } = useSchulamtYear();
  const [chosenDay, setChosenDay] = useState(toLocalDateInputValue);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [firstYear, lastYear] = selectedYear.split('/');
  const start = `${firstYear}-09-01`;
  const end = `${lastYear}-08-31`;
  const day = chosenDay >= start && chosenDay <= end ? chosenDay : start;
  const rows = dailyDeployments(requests, teachers, day);
  const singleDay = rows.filter(row => !isMultiDayDeployment(row));
  const multiDay = rows.filter(isMultiDayDeployment);

  async function downloadExcel() {
    setExporting(true);
    setExportError('');
    try {
      const response = await fetch(`/api/schulamt/tagesliste/export?date=${encodeURIComponent(day)}`, { cache: 'no-store' });
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok) throw new Error('Die Excel-Datei konnte nicht heruntergeladen werden.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `SVS-Tagesliste_${day}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError('Die Excel-Datei konnte nicht heruntergeladen werden. Bitte versuchen Sie es erneut.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="deployment-day">Einsatztag</Label>
          <Input id="deployment-day" type="date" min={start} max={end} value={day}
            onChange={event => setChosenDay(event.target.value)} />
        </div>
        <p className="py-2 text-sm text-muted-foreground" role="status">{rows.length} {rows.length === 1 ? 'Einsatz' : 'Einsätze'}</p>
        <Button type="button" variant="outline" className="min-h-11 w-full sm:ml-auto sm:w-auto" disabled={exporting} onClick={() => void downloadExcel()}>
          <Download className="size-4" aria-hidden="true" />
          {exporting ? 'Excel-Datei wird erstellt …' : 'Excel herunterladen'}
        </Button>
      </div>
      {exportError && <p role="alert" className="text-sm text-destructive">{exportError}</p>}
      {rows.length === 0 && <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Für diesen Tag liegen keine aktiven Zuweisungen vor.</p>}
      {multiDay.length > 0 && <DeploymentGroup label="Mehrtägige Vertretungen und Langzeitvertretungen" rows={multiDay} />}
      {singleDay.length > 0 && <DeploymentGroup label="Eintägige Vertretungen" rows={singleDay} />}
    </div>
  );
}
