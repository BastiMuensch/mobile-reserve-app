'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import type { RequestData } from '@/types/models';
import { toLocalDateInputValue } from '@/lib/dateKey';

export function RequestLifecycleDialog({ request, onClose, onSaved }: {
  request: RequestData; onClose: () => void; onSaved: () => void;
}) {
  const today = toLocalDateInputValue();
  const start = toLocalDateInputValue(new Date(request.date));
  const end = request.endDate ? toLocalDateInputValue(new Date(request.endDate)) : !request.isOpenEnded ? start : undefined;
  const [action, setAction] = useState<'END' | 'CANCEL'>('END');
  // A reserve may already be on site today; keeping today's assignment lets the
  // school still report the delivered hours afterwards.
  const todaysAssignments = (request.assignments ?? []).filter(assignment =>
    ['PENDING', 'ACCEPTED'].includes(assignment.status) && toLocalDateInputValue(new Date(assignment.date)) === today);
  const [keepToday, setKeepToday] = useState(todaysAssignments.length > 0);
  const [lastDay, setLastDay] = useState(end && today > end ? end : today < start ? start : today);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const { toast } = useToast();
  async function save(submission: { action: 'END' | 'CANCEL'; lastDay: string; keepToday: boolean }) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/requests/${request.id}/end`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission.action === 'CANCEL'
          ? { action: submission.action, ...(submission.keepToday ? { keepToday: true } : {}) }
          : { action: submission.action, lastDay: submission.lastDay }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error || 'Der Bedarf konnte nicht geändert werden.'); return; }
      toast({ variant: result.notificationWarning ? 'info' : 'success', title: submission.action === 'CANCEL' ? 'Bedarf storniert' : 'Rückkehr gemeldet', description: result.notificationWarnings?.join(' ') || `${result.cancelledAssignments} entfallende Einsätze aufgehoben. Vergangene Einsätze bleiben dokumentiert.` });
      onSaved(); onClose();
    } catch { setError('Die Änderung konnte nicht übermittelt werden. Bitte erneut versuchen.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving.current) onClose(); }}>
    <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Bedarf ändern / beenden</DialogTitle><DialogDescription>Vertretung für {request.substitutedTeacher || 'diese Anforderung'}. Entfallende Einsätze werden aufgehoben und betroffene Lehrkräfte informiert.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void save({ action: fields.get(`lifecycle-${request.id}`) === 'CANCEL' ? 'CANCEL' : 'END', lastDay: String(fields.get('lastDay') ?? ''), keepToday: todaysAssignments.length > 0 && keepToday });
      }}>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="sr-only">Änderung auswählen</legend>
        <label className="flex items-start gap-3 rounded-lg border p-3"><input type="radio" name={`lifecycle-${request.id}`} value="END" checked={action === 'END'} onChange={() => setAction('END')} className="mt-1" /><span><span className="font-medium">Rückkehr melden / vorzeitig beenden</span><span className="block text-xs text-muted-foreground">Vertretung wird nur bis zum gewählten Tag benötigt.</span></span></label>
        <label className="flex items-start gap-3 rounded-lg border p-3"><input type="radio" name={`lifecycle-${request.id}`} value="CANCEL" checked={action === 'CANCEL'} onChange={() => setAction('CANCEL')} className="mt-1" /><span><span className="font-medium">Verbleibenden Bedarf stornieren</span><span className="block text-xs text-muted-foreground">{todaysAssignments.length > 0 && keepToday ? 'Alle Einsätze ab morgen entfallen.' : 'Heute und alle künftigen Einsätze dieser Anforderung entfallen.'}</span></span></label>
        {action === 'CANCEL' && todaysAssignments.length > 0 && <label className="ml-7 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><input type="checkbox" name="keepToday" checked={keepToday} onChange={event => setKeepToday(event.target.checked)} className="mt-1" /><span><span className="font-medium">Heutigen Einsatz behalten</span><span className="block text-xs">{todaysAssignments.map(assignment => assignment.teacher?.name).filter(Boolean).join(', ') || 'Die Mobile Reserve'} ist heute eingeplant. Behalten Sie den Einsatz, wenn die Reserve bereits vor Ort ist oder war – dann können Sie die geleisteten Stunden anschließend melden.</span></span></label>}
        {action === 'END' && <div className="space-y-2"><Label htmlFor="request-last-day">Letzter benötigter Einsatztag (einschließlich)</Label><Input id="request-last-day" name="lastDay" type="date" value={lastDay} min={start} max={end} onInput={event => setLastDay(event.currentTarget.value)} onChange={event => setLastDay(event.target.value)} required /></div>}
      </fieldset>
      <p className="text-xs text-muted-foreground">Vergangene Einsätze sowie gemeldete oder bestätigte geleistete Stunden bleiben erhalten. Offene Stundenmeldungen werden weiterhin vom Schulamt geprüft. Freigewordene Tage werden bei der nächsten Besetzung berücksichtigt.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Abbrechen</Button><Button type="submit" disabled={busy || (action === 'END' && !lastDay)}>{busy ? 'Wird gespeichert…' : action === 'CANCEL' ? 'Verbleibenden Bedarf stornieren' : 'Rückkehr speichern'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
