'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canCorrectAssignmentHours, isAssignmentDayReached, type AssignmentHoursData, type HourCorrectionData } from '@/lib/assignmentHours';

function CorrectionHistory({ correction }: { correction: HourCorrectionData }) {
  return <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs">
    <p className="font-medium">{correction.status === 'PENDING' ? 'Prüfung offen' : correction.status === 'APPROVED' ? 'Bestätigt' : 'Abgelehnt'} · {new Date(correction.createdAt).toLocaleDateString('de-DE')}</p>
    <p>{correction.proposedHours} UStd. · {correction.additionalMinutes} Min. zusätzliche Aufgaben</p>
    <p className="whitespace-pre-wrap break-words">Grund: {correction.reason}</p>
    {correction.additionalTasks && <p className="whitespace-pre-wrap break-words">Aufgaben: {correction.additionalTasks}</p>}
    {correction.reviewNote && <p className="whitespace-pre-wrap break-words">Rückmeldung: {correction.reviewNote}</p>}
  </div>;
}

type AssignmentHoursPanelProps = { requestId: string; role: 'SCHOOL' | 'SCHULAMT'; onSaved?: () => void };
export function AssignmentHoursPanel(props: AssignmentHoursPanelProps) {
  return <AssignmentHoursPanelContent key={props.requestId} {...props} />;
}

function AssignmentHoursPanelContent({ requestId, role, onSaved }: AssignmentHoursPanelProps) {
  const [open, setOpen] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentHoursData[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('0');
  const [reason, setReason] = useState('');
  const [tasks, setTasks] = useState('');
  const activeLoad = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const [success, setSuccess] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    setLoading(true); setError(''); setLoadFailed(false);
    try {
      const response = await fetch(`/api/requests/${requestId}/hours`, { cache: 'no-store', signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(result.error || 'Stunden konnten nicht geladen werden.');
      // Future deployments cannot have delivered hours yet.
      setAssignments((result.assignments as AssignmentHoursData[]).filter(assignment => isAssignmentDayReached(assignment.date)));
    } catch (failure) {
      if (!controller.signal.aborted) { setLoadFailed(true); setError(failure instanceof Error ? failure.message : 'Stunden konnten nicht geladen werden.'); }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [requestId]);
  useEffect(() => {
    if (open) void load();
    return () => activeLoad.current?.abort();
  }, [open, load]);
  async function send(url: string, method: string, body: unknown) {
    if (submitting.current) return;
    submitting.current = true;
    activeLoad.current?.abort();
    setBusy(true); setError(''); setSuccess('');
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Die Änderung konnte nicht gespeichert werden.');
      setEditing(null);
      setSuccess(role === 'SCHOOL' ? 'Die Stundenmeldung wurde dem Schulamt zur Prüfung gesendet.' : 'Die Prüfung wurde gespeichert.');
      await load(); onSaved?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Die Änderung konnte nicht gespeichert werden.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <>
    <Button size="sm" variant="outline" type="button" className="min-h-10 whitespace-normal" onClick={() => { setError(''); setSuccess(''); setEditing(null); setOpen(true); }}>{role === 'SCHOOL' ? 'Stunden melden / korrigieren' : 'Stundenmeldungen prüfen'}</Button>
    <Dialog open={open} onOpenChange={value => { if (!submitting.current) setOpen(value); }}><DialogContent className="sm:max-w-2xl" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Stundenmeldungen</DialogTitle><DialogDescription>Geplante Unterrichtsstunden bleiben dokumentiert. Tatsächlich geleistete Unterrichtsstunden und zusätzliche Aufgaben werden vom Schulamt geprüft.</DialogDescription></DialogHeader>
      {success && <p role="status" className="text-sm text-primary">{success}</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{loadFailed && <Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void load()}>Aktuellen Stand erneut laden</Button>}</div>}
      {loading && <p role="status">Stunden werden geladen…</p>}
      {!loading && !loadFailed && assignments.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Einsätze bis einschließlich heute.</p>}
      <div className="space-y-4">{!loading && !loadFailed && assignments.map(assignment => {
        const pending = assignment.hourCorrections.find(correction => correction.status === 'PENDING');
        return <section key={assignment.id} className="space-y-3 rounded-lg border p-3">
          <p className="font-semibold">{assignment.teacher.name} · {new Date(assignment.date).toLocaleDateString('de-DE', { timeZone: 'UTC' })}</p>
          <p className="text-sm">Geplant: {assignment.hours} UStd. · Bestätigt geleistet: {assignment.actualHours === null ? 'noch nicht gemeldet' : `${assignment.actualHours} UStd. + ${assignment.actualAdditionalMinutes ?? 0} Min. zusätzliche Aufgaben`}</p>
          {role === 'SCHOOL' && !pending && canCorrectAssignmentHours(assignment) && editing !== assignment.id && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(assignment.id); setHours(String(assignment.actualHours ?? assignment.hours)); setMinutes(String(assignment.actualAdditionalMinutes ?? 0)); setReason(''); setTasks(''); setSuccess(''); }}>Stunden für diesen Tag melden</Button>}
          {role === 'SCHOOL' && !canCorrectAssignmentHours(assignment) && <p className="text-xs text-muted-foreground">Meldungen sind für bestätigte Einsätze bis einschließlich heute möglich.</p>}
          {editing === assignment.id && <form className="space-y-3 rounded-lg bg-muted/30 p-3" onSubmit={event => { event.preventDefault(); void send(`/api/assignments/${assignment.id}/hours`, 'POST', { proposedHours: Number(hours), additionalMinutes: Number(minutes), reason, additionalTasks: tasks }); }}>
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor={`hours-${assignment.id}`}>Tatsächlich geleistete UStd.</Label><Input id={`hours-${assignment.id}`} type="number" min="0" max="24" step="1" required value={hours} onChange={event => setHours(event.target.value)} disabled={busy} /></div><div className="space-y-1"><Label htmlFor={`minutes-${assignment.id}`}>Zusätzliche Aufgaben (Minuten)</Label><Input id={`minutes-${assignment.id}`} type="number" min="0" max="1440" step="1" required value={minutes} onChange={event => setMinutes(event.target.value)} disabled={busy} /></div></div>
            <div className="space-y-1"><Label htmlFor={`tasks-${assignment.id}`}>Zusätzliche Aufgaben</Label><textarea id={`tasks-${assignment.id}`} className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" value={tasks} maxLength={1000} required={Number(minutes) > 0} minLength={Number(minutes) > 0 ? 3 : undefined} onChange={event => setTasks(event.target.value)} disabled={busy} /></div>
            <div className="space-y-1"><Label htmlFor={`reason-${assignment.id}`}>Grund der Meldung / Korrektur</Label><textarea id={`reason-${assignment.id}`} className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" value={reason} minLength={3} maxLength={1000} required onChange={event => setReason(event.target.value)} disabled={busy} /></div>
            <div className="flex flex-wrap gap-2 *:max-w-full"><Button type="submit" disabled={busy}>{busy ? 'Wird gespeichert…' : 'Dem Schulamt zur Prüfung senden'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Abbrechen</Button></div>
          </form>}
          {pending && <><CorrectionHistory correction={pending} />{role === 'SCHULAMT' && <div className="space-y-2"><Label htmlFor={`review-${pending.id}`}>Rückmeldung (bei Ablehnung erforderlich)</Label><textarea id={`review-${pending.id}`} className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" value={reviewNotes[pending.id] ?? ''} maxLength={1000} disabled={busy} onChange={event => setReviewNotes(current => ({ ...current, [pending.id]: event.target.value }))} /><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void send(`/api/hour-corrections/${pending.id}`, 'PATCH', { decision: 'APPROVED', reviewNote: reviewNotes[pending.id] ?? '' })}>Bestätigen</Button><Button size="sm" variant="outline" disabled={busy || (reviewNotes[pending.id] ?? '').trim().length < 3} onClick={() => void send(`/api/hour-corrections/${pending.id}`, 'PATCH', { decision: 'REJECTED', reviewNote: reviewNotes[pending.id] ?? '' })}>Ablehnen</Button></div></div>}</>}
          {assignment.hourCorrections.some(correction => correction.status !== 'PENDING') && <details><summary className="cursor-pointer py-2 text-xs font-medium">Bisherige Stundenmeldungen</summary><div className="space-y-2">{assignment.hourCorrections.filter(correction => correction.status !== 'PENDING').map(correction => <CorrectionHistory key={correction.id} correction={correction} />)}</div></details>}
        </section>;
      })}</div>
    </DialogContent></Dialog>
  </>;
}
