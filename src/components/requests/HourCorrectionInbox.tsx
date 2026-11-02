'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AssignmentHoursPanel } from './AssignmentHoursPanel';
import { Button } from '@/components/ui/button';

type PendingRequest = { id: string; substitutedTeacher: string; school: { name: string }; assignments: { id: string; date: string; teacher: { name: string } }[] };
export function HourCorrectionInbox({ onSaved }: { onSaved?: () => void }) {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);
  const activeLoad = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    try {
      const response = await fetch('/api/hour-corrections', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (controller.signal.aborted) return;
      setRequests(result.requests); setTotal(result.total); setError(false);
    } catch { if (!controller.signal.aborted) setError(true); }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('app-refresh', refresh);
    window.addEventListener('focus', refresh);
    return () => { activeLoad.current?.abort(); window.removeEventListener('app-refresh', refresh); window.removeEventListener('focus', refresh); };
  }, [load]);
  if (error) return <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"><span>Offene Stundenmeldungen konnten nicht geladen werden.</span><Button variant="outline" size="sm" onClick={() => void load()}>Erneut laden</Button></div>;
  if (!requests.length) return null;
  return <details className="rounded-xl border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
    <summary className="cursor-pointer font-medium">Stundenmeldungen zur Prüfung · {total} {total === 1 ? 'Bedarf' : 'Bedarfe'}</summary>
    <p className="mt-2 text-xs text-muted-foreground">Auch Meldungen zu bereits beendeten oder stornierten Bedarfen bleiben hier bis zur Prüfung sichtbar.</p>
    <div className="mt-3 max-h-96 space-y-3 overflow-y-auto">{requests.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{request.school.name}</p><p className="mt-1 text-xs text-muted-foreground">Vertretung für {request.substitutedTeacher}</p><p className="mt-1 break-words text-xs">{request.assignments.map(assignment => `${assignment.teacher.name} (${new Date(assignment.date).toLocaleDateString('de-DE', { timeZone: 'UTC' })})`).join(' · ')}</p></div>
      <AssignmentHoursPanel requestId={request.id} role="SCHULAMT" onSaved={() => { void load(); onSaved?.(); }} />
    </div>)}</div>
    {total > requests.length && <p className="mt-2 text-xs text-muted-foreground">Die ersten {requests.length} von {total} Bedarfen sind sichtbar. Nach der Prüfung rücken weitere nach.</p>}
  </details>;
}
