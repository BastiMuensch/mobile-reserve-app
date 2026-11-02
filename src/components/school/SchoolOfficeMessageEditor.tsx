"use client";

import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type SchoolOfficeMessageEditorProps = { requestId: string; onSaved?: () => void };
export function SchoolOfficeMessageEditor(props: SchoolOfficeMessageEditorProps) {
  return <SchoolOfficeMessageEditorContent key={props.requestId} {...props} />;
}

function SchoolOfficeMessageEditorContent({ requestId, onSaved }: SchoolOfficeMessageEditorProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const activeLoad = useRef<AbortController | null>(null);
  const saveInFlight = useRef(false);
  useEffect(() => () => activeLoad.current?.abort(), [requestId]);
  const changeOpen = (value: boolean) => {
    if (saveInFlight.current) return;
    if (!value) activeLoad.current?.abort();
    setOpen(value);
  };
  const load = async () => {
    if (saveInFlight.current) return;
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    setOriginal(null); setDraft(''); setEnabled(false);
    setOpen(true); setLoading(true); setLoaded(false); setError('');
    try {
      const response = await fetch(`/api/requests/${requestId}/message`, { cache: 'no-store', signal: controller.signal });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || 'Die Nachricht konnte nicht geladen werden.');
      setOriginal(body.note); setDraft(body.note || ''); setEnabled(body.enabled); setLoaded(true);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Die Nachricht konnte nicht geladen werden.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const save = async () => {
    if (saveInFlight.current || !loaded || loading) return;
    saveInFlight.current = true;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/requests/${requestId}/message`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: draft, previousNote: original }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Die Nachricht konnte nicht gespeichert werden.');
      setOriginal(body.note); setOpen(false); onSaved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Die Nachricht konnte nicht gespeichert werden.'); }
    finally { saveInFlight.current = false; setSaving(false); }
  };
  return <>
    <Button type="button" variant="outline" size="sm" className="min-h-10 gap-1.5 whitespace-normal" onClick={() => void load()}><MessageSquare className="size-4" aria-hidden="true" />Nachricht ans Schulamt</Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!saving}>
        <DialogHeader><DialogTitle>Nachricht ans Schulamt</DialogTitle><DialogDescription>Ihre Schule und das zuständige Schulamt können diese Nachricht lesen. Mobile Reserven sehen sie nicht.</DialogDescription></DialogHeader>
        {loading ? <p role="status">Nachricht wird geladen …</p> : loaded ? <>
          {!enabled && <p className="text-sm text-muted-foreground">Schulnachrichten sind derzeit nicht freigeschaltet. Eine bestehende Nachricht können Sie weiterhin lesen oder entfernen.</p>}
          <label className="space-y-2 text-sm font-medium">Schulnachricht<Textarea aria-label="Schulnachricht" value={draft} maxLength={2000} rows={6} disabled={saving || !enabled} onChange={event => setDraft(event.target.value)} /></label>
          <p className="text-xs text-muted-foreground">Nur organisatorische Angaben, keine Gesundheitsdaten oder sensiblen persönlichen Informationen. {draft.length}/2000 Zeichen</p>
        </> : <Button type="button" variant="outline" onClick={() => void load()}>Nachricht erneut laden</Button>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={() => changeOpen(false)}>Schließen</Button>
          {!enabled && original && <Button variant="outline" disabled={saving} onClick={() => setDraft('')}>Nachricht entfernen</Button>}
          <Button disabled={!loaded || loading || saving || draft.trim() === (original || '') || (!enabled && Boolean(draft.trim()))} onClick={() => void save()}>{saving ? 'Wird gespeichert …' : 'Nachricht speichern'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
