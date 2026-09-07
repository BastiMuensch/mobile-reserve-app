'use client';

import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { AssignmentProofList } from '@/components/AssignmentProofList';
import { toLocalDateInputValue } from '@/lib/dateKey';
import type { AssignmentData } from '@/types/models';

export function TeacherDocuments({ teacherId, schoolYear, assignments, loadError }: {
  teacherId: string;
  schoolYear: string;
  assignments: AssignmentData[];
  loadError?: string;
}) {
  const [month, setMonth] = useState(() => toLocalDateInputValue().slice(0, 7));
  const validMonth = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month);
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-xl"><FileDown className="size-5 shrink-0 text-primary" />Dokumente &amp; Abrechnung</CardTitle>
    </CardHeader>
    <CardContent>
      <Tabs defaultValue="assignment" className="gap-4">
        <TabsList aria-label="Nachweisart" className="w-full group-data-horizontal/tabs:h-11">
          <TabsTrigger value="assignment">Pro Einsatz</TabsTrigger>
          <TabsTrigger value="month">Pro Monat</TabsTrigger>
        </TabsList>
        <TabsContent value="assignment" className="space-y-4">
          <p className="text-sm text-muted-foreground">Einsatznachweise im Schuljahr {schoolYear}. Zusammenhängende Tage derselben Zuweisung werden in einem PDF zusammengefasst.</p>
          {loadError && <p role="status" className="text-sm text-destructive">Die Nachweisliste konnte nicht aktualisiert werden. Angezeigt wird gegebenenfalls der zuletzt geladene Stand.</p>}
          <div className="max-h-[32rem] overflow-y-auto pr-1 custom-scrollbar">
            <AssignmentProofList assignments={assignments} />
          </div>
          {assignments.length > 0 && <a href={`/api/teachers/${encodeURIComponent(teacherId)}/export`} className={buttonVariants({ variant: 'outline', className: 'w-full' })}><FileDown className="size-4" />Zusätzlich als Excel exportieren</a>}
        </TabsContent>
        <TabsContent value="month" className="space-y-4">
          <p className="text-sm text-muted-foreground">Alle Einsätze des gewählten Monats als PDF zur Abrechnung. Auch frühere Monate sind auswählbar, sofern ein entsprechendes Schuljahresprofil vorhanden ist.</p>
          <div className="space-y-2">
            <Label htmlFor="export-month">Monat für die Abrechnung</Label>
            <Input id="export-month" type="month" min="2000-01" max="2100-12" value={month} onChange={event => setMonth(event.target.value)} className="min-w-0 w-full" />
          </div>
          <Button variant="outline" className="w-full" disabled={!validMonth}
            onClick={() => window.open(`/api/teachers/${encodeURIComponent(teacherId)}/export-monthly?month=${encodeURIComponent(month)}`, '_blank', 'noopener,noreferrer')}>
            <FileDown className="size-4" />Monatsübersicht herunterladen
          </Button>
        </TabsContent>
      </Tabs>
    </CardContent>
  </Card>;
}
