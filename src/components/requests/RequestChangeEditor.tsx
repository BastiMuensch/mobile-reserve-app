'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RequestData } from '@/types/models';
import { parseRequestChanges } from '@/lib/requestChanges';
import { toLocalDateInputValue } from '@/lib/dateKey';
import { requiredLessonHoursForDay } from '@/lib/matching';

export function RequestChangeEditor({ request, office = false, onSaved }: { request: RequestData; office?: boolean; onSaved?: () => void }) {
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [date,setDate] = useState(''), [lessons,setLessons] = useState<number[]>([]), [comments,setComments] = useState('');
  const lock = useRef(false);
  const history = parseRequestChanges(request.lessonChanges);
  const pending = history.filter(c => c.state === 'PENDING');
  async function save(body: object) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/requests/${request.id}/changes`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Speichern fehlgeschlagen.');
      onSaved?.(); window.dispatchEvent(new Event('app-refresh'));
      if (result.warnings?.length) setError(`Gespeichert. ${result.warnings.join(' ')}`); else setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen. Bitte Übersicht neu laden und den Stand prüfen.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const selectDay = (day: string) => {
    setDate(day);
    try { setLessons(requiredLessonHoursForDay(request, day)); } catch { setLessons([]); }
  };
  return <>
    <Button variant="outline" size="sm" className="min-h-10 whitespace-normal" onClick={event => {
      event.stopPropagation(); setComments(request.comments || ''); setError('');
      selectDay([toLocalDateInputValue(new Date(request.date)),toLocalDateInputValue()].sort().at(-1)!); setOpen(true);
    }}>{office ? `Änderungen prüfen (${pending.length})` : pending.length ? 'Änderung beim Schulamt in Prüfung' : 'Stunden / Vermerk bearbeiten'}</Button>
    <Dialog open={open} onOpenChange={value => { if (!lock.current) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{office ? 'Stundenänderungen prüfen' : 'Anforderung bearbeiten'}</DialogTitle><DialogDescription>Stundenänderungen gelten nach Freigabe durch das Schulamt. Bestehende Zuweisungen bleiben bis zu einer ausdrücklichen Änderung durch das Schulamt verbindlich.</DialogDescription></DialogHeader>
        {!office && <div className="space-y-3">
          <label className="block text-sm">Einsatztag<Input type="date" value={date} min={toLocalDateInputValue()} onChange={e => selectDay(e.target.value)} disabled={busy} /></label>
          <fieldset disabled={busy}><legend className="text-sm">Gewünschte Unterrichtsstunden</legend><div className="mt-2 flex flex-wrap gap-2">{Array.from({length:10},(_,i) => i+1).map(h => <Button key={h} type="button" variant={lessons.includes(h) ? 'default' : 'outline'} aria-pressed={lessons.includes(h)} aria-label={`${h}. Stunde`} className="min-h-11 min-w-11" onClick={() => setLessons(v => v.includes(h) ? v.filter(x => x !== h) : [...v,h].sort((a,b) => a-b))}>{h}.</Button>)}</div></fieldset>
          <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy || !lessons.length || !date} onClick={() => void save({ action:'PROPOSE', date, lessons, previous:request.lessonChanges ?? null })}>Stundenänderung zur Prüfung senden</Button>
          <p className="text-xs text-muted-foreground">Bayerische Ferien, Feiertage und Buß- und Bettag sind unterrichtsfrei. Ein einzelner Änderungswunsch betrifft nur den gewählten Tag.</p>
          <label className="block text-sm">Organisatorischer Vermerk<Textarea value={comments} maxLength={2000} rows={4} disabled={busy} onChange={e => setComments(e.target.value)} /></label>
          <p className="text-xs text-muted-foreground">Dieser Vermerk ist im Portal für beteiligte Reserven sichtbar. Beim Speichern werden das Schulamt und künftig eingesetzte Reserven per E-Mail auf die Änderung hingewiesen.</p>
          <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy || comments.trim() === (request.comments || '')} onClick={() => void save({action:'COMMENT', comments, previous:request.comments ?? null})}>Vermerk speichern und informieren</Button>
        </div>}
        <div className="space-y-3">{[...history].reverse().map(c => <div key={c.id} className="rounded border p-3 text-sm"><p>{new Date(c.date).toLocaleDateString('de-DE', {timeZone:'UTC'})}: {c.lessons.map(h => `${h}.`).join(', ')} Stunde</p><p>{c.state === 'PENDING' ? 'Beim Schulamt in Prüfung' : c.state === 'APPROVED' ? 'Freigegeben' : 'Abgelehnt'}</p>{office && c.state === 'PENDING' && <div className="mt-2 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void save({action:'APPROVE',changeId:c.id})}>Freigeben</Button><Button variant="outline" disabled={busy} onClick={() => void save({action:'REJECT',changeId:c.id})}>Ablehnen</Button></div>}</div>)}</div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
