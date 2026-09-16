"use client";

import { useId, useRef, useState, useEffect } from 'react';
import { FileDown, Copy, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function FullBackupButton({ onDownloaded }: { onDownloaded?: () => void }) {
  const id = useId();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(''), [backupPassword, setBackupPassword] = useState('');
  const [saved, setSaved] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false), [ready, setReady] = useState(false);
  const [filename, setFilename] = useState('');
  const archive = useRef<{ url: string; filename: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); if (archive.current) URL.revokeObjectURL(archive.current.url); }, []);

  function close(next: boolean) {
    if (busy) return;
    if (!next && ready && !downloaded && !window.confirm('Das Backup wurde noch nicht heruntergeladen. Wirklich verwerfen?')) return;
    if (archive.current) URL.revokeObjectURL(archive.current.url);
    archive.current = null;
    if (!next && downloaded) onDownloaded?.();
    setOpen(next); setPassword(''); setBackupPassword(''); setSaved(false); setError(''); setReady(false); setDownloaded(false); setCopied(false); setFilename('');
  }

  async function prepare(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_');
    controller.current = new AbortController();
    try {
      const response = await fetch('/api/backup/export', { method: 'POST', cache: 'no-store', signal: controller.current.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, backupPassword: secret }) });
      setPassword('');
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Backup konnte nicht erstellt werden.');
      const blob = await response.blob();
      const filename = response.headers.get('content-disposition')?.match(/filename="([A-Za-z0-9_.-]+)"/)?.[1] || 'mobile-reserve-vollbackup.mrbackup';
      archive.current = { url: URL.createObjectURL(blob), filename };
      setFilename(filename);
      setBackupPassword(secret); setReady(true);
    } catch (error) { if (!controller.current?.signal.aborted) setError(error instanceof Error ? error.message : 'Backup fehlgeschlagen.'); }
    finally { setPassword(''); setBusy(false); }
  }

  function download() {
    if (!saved || !archive.current) return;
    const link = document.createElement('a'); link.href = archive.current.url; link.download = archive.current.filename;
    document.body.appendChild(link); link.click(); link.remove(); setDownloaded(true);
  }

  return <>
    <Button variant="outline" onClick={() => close(true)}><FileDown className="size-4 text-primary" />Vollbackup herunterladen</Button>
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6"><LockKeyhole className="size-5 shrink-0" />Verschlüsseltes Vollbackup</DialogTitle>
          <DialogDescription>Enthält alle Schuljahre, Benutzerkonten mit Passwort-Hashes, Mail-Zugangsdaten, Schlüssel und Uploads. Die vollständige Wiederherstellung erfolgt mit dem Server-Werkzeug.</DialogDescription>
        </DialogHeader>
        {!ready ? <form onSubmit={prepare} className="space-y-4">
          <div className="space-y-2"><label htmlFor={`${id}-current`} className="font-medium">Ihr aktuelles Anmeldepasswort</label>
            <Input id={`${id}-current`} type="password" autoComplete="current-password" value={password} required maxLength={200} disabled={busy} onChange={e => setPassword(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground">Für jede Sicherung wird ein neues Backup-Passwort erzeugt. Es wird vor dem Download angezeigt und muss getrennt von der Datei aufbewahrt werden.</p>
          {busy && <p role="status">Vollbackup wird erstellt und verschlüsselt. Bitte warten …</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !password} className="w-full">{busy ? 'Sicherung wird erstellt …' : 'Identität bestätigen und Backup erstellen'}</Button>
        </form> : <div className="space-y-4">
          <div className="space-y-2"><label htmlFor={`${id}-backup`} className="font-medium">Passwort für diese Sicherung</label>
            <textarea id={`${id}-backup`} readOnly value={backupPassword} rows={2} autoComplete="off" spellCheck={false} className="w-full resize-none rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-sm break-all focus-visible:outline-2 focus-visible:outline-ring" />
            <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(backupPassword); setCopied(true); setError(''); } catch { setError('Bitte das Passwort im Feld markieren und manuell kopieren.'); } }}><Copy className="size-4" />{copied ? 'Passwort kopiert' : 'Passwort kopieren'}</Button>
          </div>
          <p className="break-all text-xs text-muted-foreground">Datei: {filename}</p>
          <p className="text-sm text-muted-foreground">Ohne dieses Passwort ist keine Wiederherstellung möglich. Es wird nicht dauerhaft in der App gespeichert. Verwahren Sie es getrennt von der Backupdatei, beispielsweise im Passwortmanager.</p>
          <label htmlFor={`${id}-saved`} className="flex items-start gap-3 text-sm"><input id={`${id}-saved`} type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} className="mt-1 size-4 shrink-0" />Ich habe das Backup-Passwort sicher aufbewahrt.</label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button onClick={download} disabled={!saved} className="w-full"><FileDown className="size-4" />{downloaded ? 'Verschlüsseltes Backup erneut herunterladen' : 'Verschlüsseltes Backup herunterladen'}</Button>
          {downloaded && <p role="status" className="text-sm text-muted-foreground">Download gestartet. Prüfen Sie, ob die Datei in Ihrem Download-Ordner gespeichert wurde.</p>}
          <Button variant="outline" onClick={() => close(false)} className="w-full">Schließen</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
